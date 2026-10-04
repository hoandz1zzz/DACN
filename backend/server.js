const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/uploads', express.static('uploads'));
app.use(express.static(path.join(__dirname, 'frontend')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/index.html'));
});

app.get('/lookup', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/lookup.html'));
});

app.get('/api/vehicles', (req, res) => {
    const sql = "SELECT * FROM parking_sessions WHERE status = 'IN' ORDER BY entry_time DESC";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: 'Lỗi database: ' + err.message });
        res.json(results);
    });
});

app.get('/api/lookup', (req, res) => {
    const { plate } = req.query;
    if (!plate) {
        return res.status(400).json({ error: 'Vui lòng nhập biển số xe để tìm kiếm' });
    }
    const cleanPlate = plate.trim().replace(/[-.]/g, '');
    const sql = "SELECT * FROM parking_sessions WHERE status = 'IN' AND (plate_number LIKE ? OR REPLACE(REPLACE(plate_number, '-', ''), '.', '') LIKE ?)";
    const searchPattern = `%${cleanPlate}%`;
    db.query(sql, [searchPattern, searchPattern], (err, results) => {
        if (err) return res.status(500).json({ error: 'Lỗi database: ' + err.message });
        res.json(results);
    });
});

app.delete('/api/vehicles/:id', (req, res) => {
    const { id } = req.params;
    const sql = "DELETE FROM parking_sessions WHERE id = ?";
    db.query(sql, [id], (err, result) => {
        if (err) return res.status(500).json({ error: 'Lỗi database: ' + err.message });
        res.json({ message: 'Đã xóa lượt gửi xe thành công', id: id });
    });
});

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

db.connect((err) => {
    if (err) throw err;
    console.log('Đã kết nối thành công tới MySQL Database!');
});
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E4) + path.extname(file.originalname));
    }
});
const uploadFields = multer({ storage: storage }).fields([
    { name: 'image', maxCount: 1 },
    { name: 'face_image', maxCount: 1 }
]);

const PYTHON_AI_URL = process.env.PYTHON_AI_URL || 'http://127.0.0.1:5000/detect-plate';
const PYTHON_AI_FACE_URL = process.env.PYTHON_AI_FACE_URL || 'http://ai:5000/verify-face';

const ALL_SLOTS = [
    'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8',
    'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8',
    'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8',
    'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'
];

app.get('/api/slots', (req, res) => {
    const sql = "SELECT * FROM parking_sessions WHERE status = 'IN'";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: 'Lỗi database: ' + err.message });
        
        const occupiedMap = {};
        (results || []).forEach(item => {
            if (item.slot_number) {
                occupiedMap[item.slot_number] = item;
            }
        });

        const slotsList = ALL_SLOTS.map(slot => {
            if (occupiedMap[slot]) {
                return {
                    slot_number: slot,
                    is_occupied: true,
                    session: occupiedMap[slot]
                };
            }
            return {
                slot_number: slot,
                is_occupied: false,
                session: null
            };
        });

        res.json(slotsList);
    });
});

app.post('/api/entry', uploadFields, async (req, res) => {
    try {
        const imageFile = req.files && req.files['image'] ? req.files['image'][0] : null;
        const faceFile = req.files && req.files['face_image'] ? req.files['face_image'][0] : null;

        if (!imageFile) {
            return res.status(400).json({ error: 'Vui lòng upload ảnh xe vào' });
        }

        const imagePath = imageFile.path;
        const facePath = faceFile ? faceFile.path : null;

        let plateNumber = "UNKNOWN"; 
        let croppedImage = "";
        let detectedImage = "";

        try {
            const aiResponse = await axios.post(PYTHON_AI_URL, { image_path: imagePath });
            plateNumber = aiResponse.data.plate_number;
            croppedImage = aiResponse.data.cropped_image || "";
            detectedImage = aiResponse.data.detected_image || "";
        } catch (aiError) {
            console.log('Không thể kết nối tới Python AI:', aiError.message, aiError.code);
        }

        if (plateNumber !== "UNKNOWN") {
            const checkSql = "SELECT * FROM parking_sessions WHERE plate_number = ? AND status = 'IN' LIMIT 1";
            db.query(checkSql, [plateNumber], (checkErr, checkResults) => {
                if (checkErr) return res.status(500).json({ error: 'Lỗi database: ' + checkErr.message });
                if (checkResults.length > 0) {
                    return res.status(400).json({ error: `Xe biển số ${plateNumber} đã đang ở trong bãi rồi!` });
                }
                
                insertSession();
            });
        } else {
            insertSession();
        }

        function insertSession() {
            const getSlotsSql = "SELECT slot_number FROM parking_sessions WHERE status = 'IN'";
            db.query(getSlotsSql, (slotErr, slotResults) => {
                const occupiedSlots = (slotResults || []).map(r => r.slot_number).filter(Boolean);
                const assignedSlot = ALL_SLOTS.find(s => !occupiedSlots.includes(s)) || 'A-01';

                const sql = "INSERT INTO parking_sessions (plate_number, slot_number, image_in, face_image_in, status) VALUES (?, ?, ?, ?, 'IN')";
                db.query(sql, [plateNumber, assignedSlot, imagePath, facePath], (err, result) => {
                    if (err) return res.status(500).json({ error: 'Lỗi database: ' + err.message });
                    
                    res.json({
                        message: 'Xe vào thành công',
                        sessionId: result.insertId,
                        plate_number: plateNumber,
                        slot_number: assignedSlot,
                        image_in: imagePath,
                        face_image_in: facePath,
                        cropped_image: croppedImage,
                        detected_image: detectedImage
                    });
                });
            });
        }

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/exit', uploadFields, async (req, res) => {
    try {
        const imageFile = req.files && req.files['image'] ? req.files['image'][0] : null;
        const faceFile = req.files && req.files['face_image'] ? req.files['face_image'][0] : null;

        if (!imageFile) {
            return res.status(400).json({ error: 'Vui lòng upload ảnh xe ra' });
        }

        const imagePath = imageFile.path;
        const facePath = faceFile ? faceFile.path : null;

        let plateNumber = "";
        let croppedImage = "";
        let detectedImage = "";

        try {
            const aiResponse = await axios.post(PYTHON_AI_URL, { image_path: imagePath });
            plateNumber = aiResponse.data.plate_number;
            croppedImage = aiResponse.data.cropped_image || "";
            detectedImage = aiResponse.data.detected_image || "";
        } catch (aiError) {
            plateNumber = req.body.test_plate_number || "TEST-59X1-123"; 
        }

        const findSql = "SELECT * FROM parking_sessions WHERE plate_number = ? AND status = 'IN' ORDER BY entry_time DESC LIMIT 1";
        
        db.query(findSql, [plateNumber], async (err, results) => {
            if (err) return res.status(500).json({ error: 'Lỗi database: ' + err.message });
            
            if (results.length === 0) {
                return res.status(404).json({ error: `Không tìm thấy xe biển số ${plateNumber} đang trong bãi` });
            }

            const session = results[0];
            const isOverride = req.body.override === 'true';

            // Facial verification if face_image_in and facePath exist
            let faceMatchResult = { is_match: true, similarity: 100, message: "Khuôn mặt hợp lệ" };
            if (session.face_image_in && facePath) {
                try {
                    const faceAiRes = await axios.post(PYTHON_AI_FACE_URL, {
                        face_image_in: session.face_image_in,
                        face_image_out: facePath
                    });
                    faceMatchResult = faceAiRes.data;
                } catch (faceErr) {
                    console.log('Lỗi gọi AI so sánh khuôn mặt:', faceErr.message);
                }
            }

            if (!faceMatchResult.is_match && !isOverride) {
                return res.status(400).json({
                    error: faceMatchResult.message || 'Khuôn mặt người lấy xe KHÔNG trùng khớp với chủ xe lúc vào!',
                    similarity: faceMatchResult.similarity,
                    requires_override: true,
                    plate_number: plateNumber,
                    session_id: session.id
                });
            }

            const parkingFee = 5000; 
            const updateSql = "UPDATE parking_sessions SET exit_time = CURRENT_TIMESTAMP, image_out = ?, face_image_out = ?, status = 'OUT', fee = ? WHERE id = ?";
            
            db.query(updateSql, [imagePath, facePath, parkingFee, session.id], (updateErr) => {
                if (updateErr) return res.status(500).json({ error: 'Lỗi cập nhật data: ' + updateErr.message });
                
                res.json({
                    message: 'Xe ra thành công',
                    plate_number: plateNumber,
                    entry_time: session.entry_time,
                    fee: parkingFee,
                    cropped_image: croppedImage,
                    detected_image: detectedImage,
                    face_verification: faceMatchResult
                });
            });
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server Backend đang chạy tại http://localhost:${PORT}`);
});