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
best_pt_paths = ['best.pt', 'AI/best.pt', '/app/best.pt', '/app/AI/best.pt']
best_path = next((p for p in best_pt_paths if os.path.exists(p)), None)

if best_path:
    print(f"Đã tìm thấy mô hình YOLOv8 chuyên dụng cho biển số: {best_path}")
    plate_model = YOLO(best_path)
else:
    print("Không thấy best.pt, dùng yolov8n.pt mặc định cho biển số.")
    plate_model = YOLO('yolov8n.pt')

person_model = YOLO('yolov8n.pt')
model = plate_model

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

class FaceMatchRequest(BaseModel):
    face_image_in: str
    face_image_out: str

import torchvision.transforms as T
import torch.nn.functional as F
from torchvision.models import mobilenet_v3_small, MobileNet_V3_Small_Weights

try:
    weights = MobileNet_V3_Small_Weights.DEFAULT
    mobilenet_model = mobilenet_v3_small(weights=weights)
    mobilenet_model.eval()
    face_feature_extractor = torch.nn.Sequential(*list(mobilenet_model.children())[:-1])
    transform_pipeline = T.Compose([
        T.Resize((224, 224)),
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    ])
    print("Mô hình AI Feature Extractor cho khuôn mặt đã sẵn sàng.")
except Exception as e:
    print(f"Không thể khởi tạo MobileNet Feature Extractor: {e}")
    face_feature_extractor = None

def get_face_crop(img_np):
    try:
        results = person_model(img_np, verbose=False)
        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0].item())
                if cls_id == 0: # Person
                    b = box.xyxy[0].tolist()
                    x1, y1, x2, y2 = int(b[0]), int(b[1]), int(b[2]), int(b[3])
                    head_y2 = y1 + int((y2 - y1) * 0.50)
                    h_img, w_img, _ = img_np.shape
                    x1, y1 = max(0, x1), max(0, y1)
                    x2, head_y2 = min(w_img, x2), min(h_img, head_y2)
                    if x2 > x1 and head_y2 > y1:
                        return img_np[y1:head_y2, x1:x2]
    except Exception as e:
        print(f"Lỗi phát hiện người/mặt với YOLO: {e}")
    
    h, w, _ = img_np.shape
    y1, y2 = int(h * 0.05), int(h * 0.7)
    x1, x2 = int(w * 0.15), int(w * 0.85)
    return img_np[y1:y2, x1:x2]

def compute_face_similarity(face1_np, face2_np):
    deep_sim = 0.0
    cos_sim = 0.0
    if face_feature_extractor is not None:
        try:
            pil1 = Image.fromarray(face1_np)
            pil2 = Image.fromarray(face2_np)
            
            t1 = transform_pipeline(pil1).unsqueeze(0)
            t2 = transform_pipeline(pil2).unsqueeze(0)
            
            with torch.no_grad():
                f1 = face_feature_extractor(t1).squeeze()
                f2 = face_feature_extractor(t2).squeeze()
                
                if f1.dim() > 1:
                    f1 = f1.view(f1.size(0), -1).mean(dim=-1)
                if f2.dim() > 1:
                    f2 = f2.view(f2.size(0), -1).mean(dim=-1)
                
                f1 = F.normalize(f1, p=2, dim=0)
                f2 = F.normalize(f2, p=2, dim=0)
                
                cos_sim = float(F.cosine_similarity(f1.unsqueeze(0), f2.unsqueeze(0)).item())
                # Recalibrated mapping: 0.10 -> 0%, 0.35 -> 50%, 0.60 -> 100%
                deep_sim = max(0.0, min(1.0, (cos_sim - 0.10) / 0.50))
        except Exception as err:
            print(f"Lỗi deep feature extraction: {err}")

    gray1 = cv2.cvtColor(face1_np, cv2.COLOR_RGB2GRAY)
    gray2 = cv2.cvtColor(face2_np, cv2.COLOR_RGB2GRAY)
    
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    c1 = clahe.apply(cv2.resize(gray1, (128, 128)))
    c2 = clahe.apply(cv2.resize(gray2, (128, 128)))
    
    hist1 = cv2.calcHist([c1], [0], None, [32], [0, 256])
    hist2 = cv2.calcHist([c2], [0], None, [32], [0, 256])
    cv2.normalize(hist1, hist1)
    cv2.normalize(hist2, hist2)
    
    gray_hist_sim = float(cv2.compareHist(hist1, hist2, cv2.HISTCMP_CORREL))
    gray_hist_sim = max(0.0, gray_hist_sim)

    if face_feature_extractor is not None:
        final_sim = 0.80 * deep_sim + 0.20 * gray_hist_sim
    else:
        final_sim = gray_hist_sim

    print(f"DEBUG FACE MATCH: cos_sim={cos_sim:.3f}, deep_sim={deep_sim:.3f}, gray_hist_sim={gray_hist_sim:.3f} -> final_sim={final_sim:.3f}")
    return round(final_sim * 100, 1)

@app.post("/verify-face")
async def verify_face_endpoint(request: FaceMatchRequest):
    img_in_path = request.face_image_in
    img_out_path = request.face_image_out

    def resolve_path(p):
        if not p:
            return None
        filename = os.path.basename(p)
        paths = [p, os.path.join('/app', p), os.path.join('/app/backend', p), os.path.join('/app/uploads', filename)]
        for path in paths:
            if os.path.exists(path):
                return path
        return None

    path1 = resolve_path(img_in_path)
    path2 = resolve_path(img_out_path)

    if not path1 or not path2:
        return {
            "is_match": True,
            "similarity": 100.0,
            "message": "Không có ảnh khuôn mặt để đối soát"
        }

    try:
        img1 = np.array(Image.open(path1).convert('RGB'))
        img2 = np.array(Image.open(path2).convert('RGB'))

        face1 = get_face_crop(img1)
        face2 = get_face_crop(img2)

        similarity_pct = compute_face_similarity(face1, face2)
        is_match = similarity_pct >= 40.0

        return {
            "is_match": is_match,
            "similarity": similarity_pct,
            "message": f"Khuôn mặt trùng khớp chủ xe ({similarity_pct}%)" if is_match else f"CẢNH BÁO: Khuôn mặt KHÔNG trùng khớp với chủ xe! (Độ khớp: {similarity_pct}%)"
        }
    except Exception as e:
        print(f"Lỗi so sánh khuôn mặt: {e}")
        return {
            "is_match": True,
            "similarity": 100.0,
            "message": f"Lỗi xử lý khuôn mặt: {e}"
        }
