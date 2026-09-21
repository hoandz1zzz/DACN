from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import cv2
import easyocr
import torch
from ultralytics import YOLO
import os
import numpy as np
from PIL import Image
import re

def correct_vietnamese_plate(raw_text: str) -> str:
    text = ''.join(c for c in raw_text if c.isalnum()).upper()
    if not text:
        return "UNKNOWN"

    char_map_first2 = {
        'B': '5', 'S': '5', 'Z': '2', 'O': '0', 'D': '0', 'Q': '0', 
        'I': '1', 'L': '1', 'G': '6', 'A': '4', 'E': '6'
    }

    chars = list(text)
    
    # Fix 1st character if it's a misrecognized letter (e.g. B1 -> 51)
    if len(chars) >= 2:
        if chars[0] in char_map_first2 and (chars[1].isdigit() or chars[1] in char_map_first2):
            chars[0] = char_map_first2[chars[0]]
            
        # Fix 2nd character if it's a misrecognized letter
        if chars[1] in char_map_first2 and len(chars) >= 3 and not chars[2].isdigit():
            chars[1] = char_map_first2[chars[1]]

    fixed_str = ''.join(chars)

    # Standardize plate format e.g. 51F97022 -> 51F-970.22 or 59X112345 -> 59X1-123.45
    m5 = re.match(r'^(\d{2}[A-Z0-9]{1,2})(\d{3})(\d{2})$', fixed_str)
    if m5:
        return f"{m5.group(1)}-{m5.group(2)}.{m5.group(3)}"
        
    m4 = re.match(r'^(\d{2}[A-Z0-9]{1,2})(\d{4})$', fixed_str)
    if m4:
        return f"{m4.group(1)}-{m4.group(2)}"

    return fixed_str

app = FastAPI()

use_gpu = torch.cuda.is_available()
print(f"Đang tải mô hình EasyOCR (GPU: {use_gpu})...")
reader = easyocr.Reader(['en'], gpu=use_gpu) 

print("Đang tải mô hình YOLO...")
model = YOLO('yolov8n.pt') 

class ImageRequest(BaseModel):
    image_path: str

@app.post("/detect-plate")
async def detect_plate(request: ImageRequest):
    filename = os.path.basename(request.image_path)
    search_paths = [
        request.image_path,
        os.path.join('/app', request.image_path),
        os.path.join('/app/backend', request.image_path),
        os.path.join('/app/uploads', filename),
        os.path.join('/app/backend/uploads', filename),
    ]

    full_image_path = None
    for p in search_paths:
        if os.path.exists(p):
            full_image_path = p
            break

    if not full_image_path:
        print(f"Không tìm thấy file ảnh. Đã tìm ở: {search_paths}")
        raise HTTPException(status_code=404, detail=f"Không tìm thấy file ảnh: {request.image_path}")

    try:
        pil_img = Image.open(full_image_path).convert('RGB')
        img = np.array(pil_img)
    except Exception as e:
        print(f"Lỗi khi đọc file ảnh: {e}")
        raise HTTPException(status_code=400, detail="Lỗi khi đọc file ảnh")

    results = reader.readtext(img)

    plate_candidates = []
    all_boxes = []

    for (bbox, text, prob) in results:
        clean_text = ''.join(e for e in text if e.isalnum()).upper()
        if clean_text:
            all_boxes.append(bbox)
            if len(clean_text) <= 12 and any(char.isdigit() for char in clean_text):
                plate_candidates.append(clean_text)

    if plate_candidates:
        raw_plate = "".join(plate_candidates)
        plate_text = correct_vietnamese_plate(raw_plate)
    else:
        all_texts = [''.join(e for e in text if e.isalnum()).upper() for (bbox, text, prob) in results]
        all_texts = [t for t in all_texts if t]
        raw_plate = "".join(all_texts) if all_texts else "UNKNOWN"
        plate_text = correct_vietnamese_plate(raw_plate) if raw_plate != "UNKNOWN" else "UNKNOWN"

    crop_rel_path = ""
    detect_rel_path = ""

    try:
        xs, ys = [], []
        for (bbox, text, prob) in results:
            for pt in bbox:
                xs.append(float(pt[0]))
                ys.append(float(pt[1]))

        # Fallback to YOLOv8 detections if EasyOCR bbox is empty
        if not xs:
            yolo_res = model(img)
            for r in yolo_res:
                for box in r.boxes:
                    b = box.xyxy[0].tolist()
                    xs.extend([float(b[0]), float(b[2])])
                    ys.extend([float(b[1]), float(b[3])])

        print(f"DEBUG: len(results)={len(results)}, len(xs)={len(xs)}")

        if xs and ys:
            h, w, _ = img.shape
            min_x, max_x = int(max(0, min(xs))), int(min(w, max(xs)))
            min_y, max_y = int(max(0, min(ys))), int(min(h, max(ys)))

            pad_x = int((max_x - min_x) * 0.15) + 10
            pad_y = int((max_y - min_y) * 0.15) + 10

            x1 = max(0, min_x - pad_x)
            y1 = max(0, min_y - pad_y)
            x2 = min(w, max_x + pad_x)
            y2 = min(h, max_y + pad_y)

            if x2 > x1 and y2 > y1:
                # 1. Crop image
                cropped_np = img[y1:y2, x1:x2]
                crop_filename = f"crop_{filename}"
                crop_save_path = os.path.join(os.path.dirname(full_image_path), crop_filename)
                Image.fromarray(cropped_np).save(crop_save_path)
                crop_rel_path = f"uploads/{crop_filename}"

                # 2. Draw bounding box on full image
                detect_np = img.copy()
                cv2.rectangle(detect_np, (x1, y1), (x2, y2), (0, 255, 0), 4)
                detect_filename = f"detect_{filename}"
                detect_save_path = os.path.join(os.path.dirname(full_image_path), detect_filename)
                Image.fromarray(detect_np).save(detect_save_path)
                detect_rel_path = f"uploads/{detect_filename}"
    except Exception as crop_err:
        print(f"Lỗi khi cắt ảnh: {crop_err}")

    print(f"Nhận diện thành công: {plate_text} | Crop: {crop_rel_path}")
    return {
        "plate_number": plate_text,
        "cropped_image": crop_rel_path,
        "detected_image": detect_rel_path
    }