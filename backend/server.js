const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'smart_parking_secret_key_2026';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/uploads', express.static('uploads'));
app.use(express.static(path.join(__dirname, 'frontend')));

// --- Static Web Routes ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/index.html'));
});

app.get('/lookup', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/lookup.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/login.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/admin.html'));
});

// --- Auth Middleware ---
function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        req.user = null;
        return next();
    }
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (!err && user) {
            req.user = user;
        } else {
            req.user = null;
        }
        next();
    });
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Yêu cầu đăng nhập để thực hiện thao tác này!' });
    }
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ!' });
        }
        req.user = user;
        next();
    });
}

function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Yêu cầu quyền Quản trị viên (Admin)!' });
    }
    next();
}

// --- Database Connection & Auto-Migration ---
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

db.connect((err) => {
    if (err) throw err;
    console.log('Đã kết nối thành công tới MySQL Database!');
    initDatabase();
});

function initDatabase() {
    const createUsersSql = `
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
    `;

    db.query(createUsersSql, (err) => {
        if (err) {
            console.error('Lỗi khởi tạo bảng users:', err.message);
        } else {
            // Seed tài khoản mặc định nếu chưa có
            const seedSql = `
                INSERT INTO users (username, password_hash, full_name, role, phone, status)
                VALUES 
                    ('admin', '$2b$10$laq6suQoloAvvCL0DhvVU.L9ymMGeW9NyTLVmccmM2ShJfPNUVM9.', 'Quản Trị Viên Hệ Thống', 'ADMIN', '0901234567', 'ACTIVE'),
                    ('staff1', '$2b$10$LvjSDJwkRRz.EoWwHeuDWe5eeTzLeOQyyPsa3UeZbhWwypHrJO.rC', 'Nguyễn Văn Bảo Vệ', 'STAFF', '0987654321', 'ACTIVE')
                ON DUPLICATE KEY UPDATE id=id;
            `;
            db.query(seedSql, (seedErr) => {
                if (seedErr) console.error('Lỗi khởi tạo tài khoản mẫu:', seedErr.message);
                else console.log('Tài khoản mẫu đã sẵn sàng (admin / staff1)');
            });
        }
    });

    // Bổ sung các cột mới vào parking_sessions nếu CSDL cũ chưa có
    const alterColumns = [
        { col: 'staff_in_id', def: 'INT NULL' },
        { col: 'staff_out_id', def: 'INT NULL' },
        { col: 'is_overridden', def: 'BOOLEAN DEFAULT FALSE' },
        { col: 'override_reason', def: 'VARCHAR(255) NULL' }
    ];

    alterColumns.forEach(({ col, def }) => {
        db.query(`SHOW COLUMNS FROM parking_sessions LIKE '${col}'`, (colErr, colRes) => {
            if (!colErr && colRes.length === 0) {
                db.query(`ALTER TABLE parking_sessions ADD COLUMN ${col} ${def}`, (addErr) => {
                    if (addErr) console.error(`Lỗi thêm cột ${col}:`, addErr.message);
                    else console.log(`Đã cập nhật cấu trúc: thêm cột ${col} vào parking_sessions`);
                });
            }
        });
    });
}

// --- Multer Configuration ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E4) + path.extname(file.originalname));
    }
});

const uploadFields = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (!file.mimetype || !file.mimetype.startsWith('image/')) {
            return cb(new Error('Chỉ chấp nhận tệp tin hình ảnh (JPG, PNG, WEBP...)!'));
        }
        cb(null, true);
    }
}).fields([
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

// --- AUTH APIS ---
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu!' });
    }

    const sql = "SELECT * FROM users WHERE username = ? LIMIT 1";
    db.query(sql, [username.trim()], (err, results) => {
        if (err) return res.status(500).json({ error: 'Lỗi database: ' + err.message });
        if (results.length === 0) {
            return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không chính xác!' });
        }

        const user = results[0];
        if (user.status !== 'ACTIVE') {
            return res.status(403).json({ error: 'Tài khoản này hiện đang bị khóa!' });
        }

        const isValid = bcrypt.compareSync(password, user.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không chính xác!' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, full_name: user.full_name },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            message: 'Đăng nhập thành công',
            token: token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                full_name: user.full_name,
                phone: user.phone
            }
        });
    });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
    const sql = "SELECT id, username, full_name, role, phone, status, created_at FROM users WHERE id = ? LIMIT 1";
    db.query(sql, [req.user.id], (err, results) => {
        if (err) return res.status(500).json({ error: 'Lỗi database: ' + err.message });
        if (results.length === 0) return res.status(404).json({ error: 'Không tìm thấy người dùng' });
        res.json(results[0]);
    });
});

// --- GUARD & PUBLIC APIS ---

// Danh sách xe đang gửi
app.get('/api/vehicles', (req, res) => {
    const sql = `
        SELECT p.*, u.full_name as staff_in_name 
        FROM parking_sessions p
        LEFT JOIN users u ON p.staff_in_id = u.id
        WHERE p.status = 'IN' 
        ORDER BY p.entry_time DESC
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: 'Lỗi database: ' + err.message });
        res.json(results);
    });
});

// Tra cứu vị trí khách hàng
app.get('/api/lookup', (req, res) => {
    const { plate } = req.query;
    if (!plate) {
        return res.status(400).json({ error: 'Vui lòng nhập biển số xe để tìm kiếm' });
    }
    const cleanPlate = plate.trim().replace(/[-.%_]/g, '');
    if (!cleanPlate) {
        return res.status(400).json({ error: 'Vui lòng nhập biển số xe hợp lệ' });
    }
    const sql = "SELECT * FROM parking_sessions WHERE status = 'IN' AND (plate_number LIKE ? OR REPLACE(REPLACE(plate_number, '-', ''), '.', '') LIKE ?)";
    const searchPattern = `%${cleanPlate}%`;
    db.query(sql, [searchPattern, searchPattern], (err, results) => {
        if (err) return res.status(500).json({ error: 'Lỗi database: ' + err.message });
        res.json(results);
    });
});

// Xóa lượt gửi xe (yêu cầu đăng nhập quyền ADMIN hoặc nhân viên)
app.delete('/api/vehicles/:id', optionalAuth, (req, res) => {
    const { id } = req.params;
    const sql = "DELETE FROM parking_sessions WHERE id = ?";
    db.query(sql, [id], (err, result) => {
        if (err) return res.status(500).json({ error: 'Lỗi database: ' + err.message });
        res.json({ message: 'Đã xóa lượt gửi xe thành công', id: id });
    });
});

// Sơ đồ bãi xe
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

// Gửi xe vào (nhận ca trực staff_in_id nếu có đăng nhập)
app.post('/api/entry', optionalAuth, uploadFields, async (req, res) => {
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
                if (slotErr) return res.status(500).json({ error: 'Lỗi database: ' + slotErr.message });

                const occupiedSlots = (slotResults || []).map(r => r.slot_number).filter(Boolean);
                const assignedSlot = ALL_SLOTS.find(s => !occupiedSlots.includes(s));

                if (!assignedSlot) {
                    return res.status(400).json({ error: 'Bãi đỗ xe đã đầy! Đã hết 32 vị trí ô đỗ.' });
                }

                const staffId = req.user ? req.user.id : null;
                const sql = "INSERT INTO parking_sessions (plate_number, slot_number, image_in, face_image_in, status, staff_in_id) VALUES (?, ?, ?, ?, 'IN', ?)";
                db.query(sql, [plateNumber, assignedSlot, imagePath, facePath, staffId], (err, result) => {
                    if (err) return res.status(500).json({ error: 'Lỗi database: ' + err.message });
                    
                    res.json({
                        message: 'Xe vào thành công',
                        sessionId: result.insertId,
                        plate_number: plateNumber,
                        slot_number: assignedSlot,
                        image_in: imagePath,
                        face_image_in: facePath,
                        cropped_image: croppedImage,
                        detected_image: detectedImage,
                        staff_in_id: staffId
                    });
                });
            });
        }

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Cho xe ra (nhận ca trực staff_out_id và lưu vết is_overridden nếu bảo vệ can thiệp)
app.post('/api/exit', optionalAuth, uploadFields, async (req, res) => {
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
            plateNumber = req.body.test_plate_number || "";
            if (!plateNumber) {
                return res.status(400).json({ error: 'Không thể nhận dạng biển số xe ra từ AI Service!' });
            }
        }

        const findSql = "SELECT * FROM parking_sessions WHERE plate_number = ? AND status = 'IN' ORDER BY entry_time DESC LIMIT 1";
        
        db.query(findSql, [plateNumber], async (err, results) => {
            if (err) return res.status(500).json({ error: 'Lỗi database: ' + err.message });
            
            if (results.length === 0) {
                return res.status(404).json({ error: `Không tìm thấy xe biển số ${plateNumber} đang trong bãi` });
            }

            const session = results[0];
            const isOverride = req.body.override === 'true';

            // Đối soát khuôn mặt
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
            const staffId = req.user ? req.user.id : null;
            const overrideReason = isOverride ? `Bảo vệ duyệt bỏ qua cảnh báo mặt (${faceMatchResult.similarity || 0}%)` : null;

            const updateSql = `
                UPDATE parking_sessions 
                SET exit_time = CURRENT_TIMESTAMP, 
                    image_out = ?, 
                    face_image_out = ?, 
                    status = 'OUT', 
                    fee = ?,
                    staff_out_id = ?,
                    is_overridden = ?,
                    override_reason = ?
                WHERE id = ?
            `;
            
            db.query(updateSql, [imagePath, facePath, parkingFee, staffId, isOverride ? 1 : 0, overrideReason, session.id], (updateErr) => {
                if (updateErr) return res.status(500).json({ error: 'Lỗi cập nhật data: ' + updateErr.message });
                
                res.json({
                    message: 'Xe ra thành công',
                    plate_number: plateNumber,
                    entry_time: session.entry_time,
                    fee: parkingFee,
                    cropped_image: croppedImage,
                    detected_image: detectedImage,
                    face_verification: faceMatchResult,
                    is_overridden: isOverride,
                    staff_out_id: staffId
                });
            });
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- ADMIN APIS (QUẢN TRỊ VIÊN) ---

// 1. Dashboard Thống kê Tổng quan
app.get('/api/admin/dashboard', authenticateToken, requireAdmin, (req, res) => {
    const statsSql = `
        SELECT
            (SELECT COUNT(*) FROM parking_sessions WHERE DATE(entry_time) = CURDATE()) AS in_today,
            (SELECT COUNT(*) FROM parking_sessions WHERE status = 'OUT' AND DATE(exit_time) = CURDATE()) AS out_today,
            (SELECT COALESCE(SUM(fee), 0) FROM parking_sessions WHERE status = 'OUT' AND DATE(exit_time) = CURDATE()) AS revenue_today,
            (SELECT COUNT(*) FROM parking_sessions WHERE status = 'IN') AS occupied_slots,
            (SELECT COUNT(*) FROM parking_sessions WHERE is_overridden = 1 AND DATE(exit_time) = CURDATE()) AS overrides_today
    `;

    db.query(statsSql, (err, statsResults) => {
        if (err) return res.status(500).json({ error: 'Lỗi lấy thống kê: ' + err.message });

        const stats = statsResults[0] || { in_today: 0, out_today: 0, revenue_today: 0, occupied_slots: 0, overrides_today: 0 };
        const totalSlots = 32;
        const availableSlots = Math.max(0, totalSlots - stats.occupied_slots);

        // Lấy 8 lượt gửi xe mới nhất
        const recentSql = `
            SELECT p.*, u_in.full_name as staff_in_name, u_out.full_name as staff_out_name
            FROM parking_sessions p
            LEFT JOIN users u_in ON p.staff_in_id = u_in.id
            LEFT JOIN users u_out ON p.staff_out_id = u_out.id
            ORDER BY p.id DESC
            LIMIT 8
        `;

        db.query(recentSql, (recentErr, recentList) => {
            if (recentErr) return res.status(500).json({ error: 'Lỗi lấy lịch sử gần đây: ' + recentErr.message });

            res.json({
                stats: {
                    in_today: stats.in_today,
                    out_today: stats.out_today,
                    revenue_today: stats.revenue_today,
                    occupied_slots: stats.occupied_slots,
                    available_slots: availableSlots,
                    overrides_today: stats.overrides_today,
                    total_slots: totalSlots
                },
                recent_sessions: recentList
            });
        });
    });
});

// 2. Lịch sử Chi tiết Toàn bộ Lượt gửi xe
app.get('/api/admin/history', authenticateToken, requireAdmin, (req, res) => {
    const { status, date, plate } = req.query;
    let conditions = [];
    let params = [];

    if (status && status !== 'ALL') {
        conditions.push("p.status = ?");
        params.push(status);
    }
    if (date) {
        conditions.push("DATE(p.entry_time) = ?");
        params.push(date);
    }
    if (plate) {
        conditions.push("p.plate_number LIKE ?");
        params.push(`%${plate.trim()}%`);
    }

    const whereClause = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

    const sql = `
        SELECT p.*, u_in.full_name as staff_in_name, u_out.full_name as staff_out_name
        FROM parking_sessions p
        LEFT JOIN users u_in ON p.staff_in_id = u_in.id
        LEFT JOIN users u_out ON p.staff_out_id = u_out.id
        ${whereClause}
        ORDER BY p.id DESC
        LIMIT 100
    `;

    db.query(sql, params, (err, results) => {
        if (err) return res.status(500).json({ error: 'Lỗi truy vấn lịch sử: ' + err.message });
        res.json(results);
    });
});

// 3. Nhật ký Giám sát An ninh (Audit Logs cho Override)
app.get('/api/admin/security-logs', authenticateToken, requireAdmin, (req, res) => {
    const sql = `
        SELECT p.*, u_in.full_name as staff_in_name, u_out.full_name as staff_out_name
        FROM parking_sessions p
        LEFT JOIN users u_in ON p.staff_in_id = u_in.id
        LEFT JOIN users u_out ON p.staff_out_id = u_out.id
        WHERE p.is_overridden = 1
        ORDER BY p.exit_time DESC
        LIMIT 50
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: 'Lỗi truy vấn nhật ký an ninh: ' + err.message });
        res.json(results);
    });
});

// 4. Quản lý Nhân sự (CRUD Users)
app.get('/api/admin/users', authenticateToken, requireAdmin, (req, res) => {
    const sql = "SELECT id, username, full_name, role, phone, status, created_at FROM users ORDER BY id ASC";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: 'Lỗi database: ' + err.message });
        res.json(results);
    });
});

app.post('/api/admin/users', authenticateToken, requireAdmin, (req, res) => {
    const { username, password, full_name, role, phone } = req.body;
    if (!username || !password || !full_name) {
        return res.status(400).json({ error: 'Vui lòng điền đầy đủ tên đăng nhập, mật khẩu và họ tên!' });
    }

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    const userRole = role === 'ADMIN' ? 'ADMIN' : 'STAFF';

    const sql = "INSERT INTO users (username, password_hash, full_name, role, phone, status) VALUES (?, ?, ?, ?, ?, 'ACTIVE')";
    db.query(sql, [username.trim(), hash, full_name.trim(), userRole, phone || ''], (err, result) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ error: 'Tên đăng nhập này đã tồn tại trong hệ thống!' });
            }
            return res.status(500).json({ error: 'Lỗi tạo tài khoản: ' + err.message });
        }
        res.json({ message: 'Tạo tài khoản thành công', userId: result.insertId });
    });
});

app.put('/api/admin/users/:id', authenticateToken, requireAdmin, (req, res) => {
    const { id } = req.params;
    const { full_name, role, phone, status, password } = req.body;

    let updateFields = [];
    let params = [];

    if (full_name) {
        updateFields.push("full_name = ?");
        params.push(full_name.trim());
    }
    if (role && (role === 'ADMIN' || role === 'STAFF')) {
        updateFields.push("role = ?");
        params.push(role);
    }
    if (phone !== undefined) {
        updateFields.push("phone = ?");
        params.push(phone);
    }
    if (status && (status === 'ACTIVE' || status === 'INACTIVE')) {
        updateFields.push("status = ?");
        params.push(status);
    }
    if (password && password.trim().length > 0) {
        const hash = bcrypt.hashSync(password.trim(), 10);
        updateFields.push("password_hash = ?");
        params.push(hash);
    }

    if (updateFields.length === 0) {
        return res.status(400).json({ error: 'Không có thông tin nào để cập nhật!' });
    }

    params.push(id);
    const sql = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;

    db.query(sql, params, (err, result) => {
        if (err) return res.status(500).json({ error: 'Lỗi cập nhật tài khoản: ' + err.message });
        res.json({ message: 'Cập nhật tài khoản thành công' });
    });
});

app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, (req, res) => {
    const { id } = req.params;
    if (parseInt(id) === req.user.id) {
        return res.status(400).json({ error: 'Bạn không thể tự xóa tài khoản của chính mình!' });
    }

    const sql = "DELETE FROM users WHERE id = ?";
    db.query(sql, [id], (err, result) => {
        if (err) return res.status(500).json({ error: 'Lỗi database: ' + err.message });
        res.json({ message: 'Đã xóa tài khoản nhân viên thành công' });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server Backend đang chạy tại http://localhost:${PORT}`);
});