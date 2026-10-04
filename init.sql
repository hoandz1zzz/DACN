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
    fee INT DEFAULT 0
);

