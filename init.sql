CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role ENUM('ADMIN', 'STAFF') NOT NULL DEFAULT 'STAFF',
    phone VARCHAR(20) DEFAULT '',
    status ENUM('ACTIVE', 'INACTIVE') DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS parking_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    plate_number VARCHAR(50),
    slot_number VARCHAR(50),
    image_in VARCHAR(255),
    image_out VARCHAR(255),
    face_image_in VARCHAR(255),
    face_image_out VARCHAR(255),
    status VARCHAR(10) DEFAULT 'IN',
    entry_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    exit_time TIMESTAMP NULL,
    fee INT DEFAULT 0,
    staff_in_id INT NULL,
    staff_out_id INT NULL,
    is_overridden BOOLEAN DEFAULT FALSE,
    override_reason VARCHAR(255) NULL,
    FOREIGN KEY (staff_in_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (staff_out_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Tài khoản khởi tạo ban đầu:
-- 1. admin / admin123 (Quản trị viên)
-- 2. staff1 / staff123 (Nhân viên bảo vệ)
INSERT INTO users (username, password_hash, full_name, role, phone, status)
VALUES 
    ('admin', '$2b$10$laq6suQoloAvvCL0DhvVU.L9ymMGeW9NyTLVmccmM2ShJfPNUVM9.', 'Quản Trị Viên Hệ Thống', 'ADMIN', '0901234567', 'ACTIVE'),
    ('staff1', '$2b$10$LvjSDJwkRRz.EoWwHeuDWe5eeTzLeOQyyPsa3UeZbhWwypHrJO.rC', 'Nguyễn Văn Bảo Vệ', 'STAFF', '0987654321', 'ACTIVE')
ON DUPLICATE KEY UPDATE id=id;
