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

app.get('/api/vehicles', (req, res) => {
    const sql = "SELECT * FROM parking_sessions WHERE status = 'IN' ORDER BY entry_time DESC";
    db.query(sql, (err, results) => {
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
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

const PYTHON_AI_URL = process.env.PYTHON_AI_URL || 'http://127.0.0.1:5000/detect-plate';

app.post('/api/entry', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Vui lòng upload ảnh xe vào' });
        }

        const imagePath = req.file.path;

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
            const sql = "INSERT INTO parking_sessions (plate_number, image_in, status) VALUES (?, ?, 'IN')";
            db.query(sql, [plateNumber, imagePath], (err, result) => {
                if (err) return res.status(500).json({ error: 'Lỗi database: ' + err.message });
                
                res.json({
                    message: 'Xe vào thành công',
                    sessionId: result.insertId,
                    plate_number: plateNumber,
                    image_in: imagePath,
                    cropped_image: croppedImage,
                    detected_image: detectedImage
                });
            });
        }

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/exit', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Vui lòng upload ảnh xe ra' });
        }

        const imagePath = req.file.path;
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
        
        db.query(findSql, [plateNumber], (err, results) => {
            if (err) return res.status(500).json({ error: 'Lỗi database: ' + err.message });
            
            if (results.length === 0) {
                return res.status(404).json({ error: `Không tìm thấy xe biển số ${plateNumber} đang trong bãi` });
            }

            const session = results[0];
            const parkingFee = 5000; 
            const updateSql = "UPDATE parking_sessions SET exit_time = CURRENT_TIMESTAMP, image_out = ?, status = 'OUT', fee = ? WHERE id = ?";
            
            db.query(updateSql, [imagePath, parkingFee, session.id], (updateErr) => {
                if (updateErr) return res.status(500).json({ error: 'Lỗi cập nhật data: ' + updateErr.message });
                
                res.json({
                    message: 'Xe ra thành công',
                    plate_number: plateNumber,
                    entry_time: session.entry_time,
                    fee: parkingFee,
                    cropped_image: croppedImage,
                    detected_image: detectedImage
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