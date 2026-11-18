# Hệ Thống Quản Lý Bãi Đỗ Xe Thông Minh (Nhận Diện Biển Số & Xác Thực Khuôn Mặt)

Hệ thống **Quản lý Bãi đỗ xe Thông minh (Smart Parking Management System)** hoạt động theo kiến trúc microservices đóng gói bằng Docker, tự động hóa quy trình xe vào/ra thông qua **Nhận diện biển số xe Việt Nam (YOLOv8 + EasyOCR)** và **Đối soát khuôn mặt chủ xe (YOLOv8 + MobileNetV3-Small)**, kết hợp **REST API (Node.js/Express)**, **MySQL 8.0** và **Giao diện Web phân quyền**.

---

## Tính Năng Nổi Bật

- **Nhận Diện Biển Số Xe Tự Động (ALPR)**
  - Phát hiện và cắt vùng biển số bằng mô hình **YOLOv8** huấn luyện riêng (`best.pt`, dự phòng `yolov8n.pt`) kết hợp **EasyOCR** để trích xuất ký tự.
  - Tích hợp hàm hậu xử lý chuyên biệt cho biển số Việt Nam (`correct_vietnamese_plate`) nhằm sửa các lỗi nhận diện nhầm phổ biến (ví dụ: `B/S → 5`, `O/D/Q → 0`, `I/L → 1`) và chuẩn hóa định dạng (ví dụ: `51F-970.22`, `59X1-123.45`).
  - Tự động lưu ảnh cắt biển số (`crop_*`) và ảnh khoanh vùng đối tượng (`detect_*`) phục vụ đối chiếu.

- **Đối Soát Khuôn Mặt & Ghi Log Can Thiệp Bảo Mật**
  - Thu thập ảnh khuôn mặt người lái xe tại thời điểm vào và ra.
  - Phát hiện vùng đầu/khuôn mặt bằng **YOLOv8** (`yolov8n.pt`), sau đó tính độ tương đồng kết hợp giữa **MobileNetV3-Small** (cosine similarity, trọng số 80%) và **OpenCV CLAHE histogram** (tương quan mức xám, trọng số 20%).
  - Tự động cảnh báo và chặn xe ra nếu độ trùng khớp dưới ngưỡng `40.0%`; hỗ trợ bảo vệ xác nhận duyệt thủ công (`override=true`) và lưu vết chi tiết (`is_overridden`, `override_reason`, `staff_out_id`).

- **Quản Lý Ô Đỗ Thời Gian Thực & Tính Phí Tự Động**
  - Quản lý **32 vị trí ô đỗ** (`A1–A8`, `B1–B8`, `C1–C8`, `D1–D8`), tự động cấp phát ô trống khi xe vào và chặn trùng lặp biển số đang ở trong bãi.
  - Trang tra cứu công khai (`/lookup`) giúp kiểm tra trạng thái xe và vị trí ô đỗ hiện tại.
  - Tự động ghi nhận thời gian ra và tính phí gửi xe (`5.000 VNĐ` / lượt).

- **Phân Quyền Người Dùng (RBAC) & Trang Quản Trị**
  - Xác thực bằng **JWT** kết hợp mã hóa mật khẩu **bcryptjs** với hai vai trò: `ADMIN` (Quản trị viên) và `STAFF` (Nhân viên bảo vệ).
  - **Admin Portal** (`/admin`) cung cấp thống kê tổng quan, lịch sử xe vào/ra, báo cáo doanh thu, nhật ký cảnh báo bảo mật (security logs) và quản lý tài khoản nhân viên (CRUD).

---

## Kiến Trúc Hệ Thống

Hệ thống được triển khai với **Docker Compose** gồm 3 service giao tiếp qua mạng nội bộ:

```
┌─────────────────────────┐      HTTP / REST       ┌─────────────────────────┐
│  Frontend (Vanilla JS)  │ ◄────────────────────► │   Backend (Node.js)     │
│  Cổng xe / Tra cứu /    │      Cổng 3000         │   Express 5 + Multer    │
│  Trang Quản trị         │                        │   JWT Auth + RBAC       │
└─────────────────────────┘                        └───────────┬─────────────┘
                                                               │
                                         ┌─────────────────────┴─────────────────────┐
                                         │                                           │
                                         ▼ (REST: /detect-plate, /verify-face)       ▼ (MySQL2)
                           ┌─────────────────────────┐                 ┌─────────────────────────┐
                           │   AI Service (Python)   │                 │   Database (MySQL 8.0)  │
                           │   FastAPI + Uvicorn     │                 │   smart_parking_db      │
                           │   YOLOv8 + EasyOCR      │                 │   Cổng 3306             │
                           │   MobileNetV3-Small     │                 └─────────────────────────┘
                           │   Cổng 5000             │
                           └─────────────────────────┘
```

---

## Công Nghệ Sử Dụng

| Thành phần | Công nghệ |
| :--- | :--- |
| **AI / Thị giác máy tính** | Python 3.11, FastAPI, Uvicorn, PyTorch (CPU), TorchVision (`MobileNetV3-Small`), Ultralytics (`YOLOv8`), EasyOCR, OpenCV, Pillow, NumPy |
| **Backend** | Node.js 18, Express 5, MySQL2, Multer, JSON Web Token (`jsonwebtoken`), `bcryptjs`, Axios, CORS, dotenv |
| **Frontend** | HTML5, CSS3, Vanilla JavaScript |
| **Cơ sở dữ liệu** | MySQL 8.0 (tự động khởi tạo schema và dữ liệu mẫu qua `init.sql`) |
| **Đóng gói & Triển khai** | Docker, Docker Compose |

---

## Hướng Dẫn Cài Đặt & Chạy Dự Án

### Yêu cầu môi trường

- [Docker](https://www.docker.com/) & [Docker Compose](https://docs.docker.com/compose/)

### Khởi chạy bằng Docker Compose

1. **Clone mã nguồn:**
   ```bash
   git clone https://github.com/hoandz1zzz/DACN.git
   cd DACN
   ```

2. **Build và chạy toàn bộ hệ thống:**
   ```bash
   docker compose up --build
   ```
   > **Lưu ý:** Trong lần chạy đầu tiên, container `ai` sẽ tải trọng số mô hình EasyOCR và PyTorch/YOLOv8 và lưu cache vào Docker volume `easyocr_model_data`.

3. **Truy cập các giao diện:**
   - **Cổng kiểm soát xe vào/ra:** [http://localhost:3000/](http://localhost:3000/)
   - **Tra cứu vị trí xe (Công khai):** [http://localhost:3000/lookup](http://localhost:3000/lookup)
   - **Đăng nhập Nhân viên / Quản trị:** [http://localhost:3000/login](http://localhost:3000/login)
   - **Trang Quản trị (Admin Portal):** [http://localhost:3000/admin](http://localhost:3000/admin)
   - **Tài liệu API của AI Service (Swagger):** [http://localhost:5000/docs](http://localhost:5000/docs)

### Tài Khoản Mặc Định

Được khởi tạo tự động từ `init.sql`:

| Vai trò | Tên đăng nhập | Mật khẩu |
| :--- | :--- | :--- |
| `ADMIN` | `admin` | `admin123` |
| `STAFF` | `staff1` | `staff123` |

---

## Tổng Quan API

### Backend (`http://localhost:3000`)

| Phương thức | Endpoint | Quyền truy cập | Mô tả |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/login` | Công khai | Đăng nhập và cấp JWT |
| `GET` | `/api/auth/me` | Đã đăng nhập | Lấy thông tin tài khoản hiện tại |
| `GET` | `/api/slots` | Công khai | Lấy trạng thái 32 ô đỗ (`A1–D8`) |
| `GET` | `/api/vehicles` | Công khai | Danh sách xe đang gửi trong bãi |
| `GET` | `/api/lookup` | Công khai | Tra cứu thông tin xe theo biển số |
| `POST` | `/api/entry` | Công khai / Bảo vệ | Upload ảnh xe & khuôn mặt vào, chạy ALPR, cấp ô đỗ |
| `POST` | `/api/exit` | Công khai / Bảo vệ | Chạy ALPR & đối soát khuôn mặt ra, tính phí, đóng lượt gửi |
| `GET` | `/api/admin/dashboard` | Admin | Thống kê tổng quan cho trang quản trị |
| `GET` | `/api/admin/history` | Admin | Lịch sử các lượt xe vào/ra |
| `GET` | `/api/admin/revenue-report` | Admin | Báo cáo doanh thu |
| `GET` | `/api/admin/security-logs` | Admin | Nhật ký các lượt bảo vệ duyệt bỏ qua cảnh báo khuôn mặt |
| `GET/POST/PUT/DELETE` | `/api/admin/users` | Admin | Quản lý tài khoản `ADMIN` và `STAFF` |

### AI Service (`http://localhost:5000`)

| Phương thức | Endpoint | Mô tả |
| :--- | :--- | :--- |
| `POST` | `/detect-plate` | Phát hiện và đọc ký tự biển số xe Việt Nam từ đường dẫn ảnh |
| `POST` | `/verify-face` | So sánh ảnh khuôn mặt lúc vào và lúc ra, trả về phần trăm trùng khớp |

---

## Cấu Trúc Thư Mục

```text
DACN/
├── AI/
│   ├── Dockerfile            # Image Python 3.11 + PyTorch CPU + EasyOCR + YOLOv8
│   ├── main.py               # FastAPI service (/detect-plate, /verify-face)
│   ├── best.pt               # Trọng số YOLOv8 huấn luyện riêng cho biển số xe
│   └── yolov8n.pt            # Trọng số YOLOv8 nano phát hiện người / dự phòng
├── backend/
│   ├── Dockerfile            # Image Node.js 18 Alpine
│   ├── package.json          # Các thư viện Express, MySQL2, Multer, JWT, bcryptjs
│   ├── server.js             # Express REST API, middleware phân quyền, auto-migration DB
│   └── uploads/              # Thư mục lưu ảnh tải lên, ảnh crop và ảnh khoanh vùng
├── frontend/
│   ├── index.html            # Giao diện cổng kiểm soát xe vào/ra
│   ├── app.js                # Logic xử lý trang cổng xe
│   ├── lookup.html           # Giao diện tra cứu vị trí xe công khai
│   ├── lookup.js             # Logic trang tra cứu
│   ├── login.html            # Trang đăng nhập Nhân viên / Quản trị viên
│   ├── admin.html            # Trang quản trị (Dashboard, báo cáo, log bảo mật, nhân sự)
│   ├── admin.js              # Logic trang quản trị
│   └── style.css             # CSS dùng chung
├── docker-compose.yml        # Cấu hình chạy đa container (db, ai, backend)
└── init.sql                  # Khởi tạo bảng (users, parking_sessions) & tài khoản mẫu
```
