
const express = require('express');
const { sql } = require('./db');
const authMiddleware = require('./middleware/authMiddleware');

const router = express.Router();

// Kiểm tra người dùng có thuộc cuộc trò chuyện không.
async function getConnection(connectionId, userId) {
    const result = await sql.query`
        SELECT ConnectionId, SenderId, ReceiverId
        FROM Connections
        WHERE ConnectionId = ${connectionId}
          AND (SenderId = ${userId} OR ReceiverId = ${userId})
    `;

    return result.recordset[0] || null;
}

// GET /api/chat/connections
// Lấy danh sách cuộc trò chuyện của tài khoản hiện tại.
router.get('/connections', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;

        const result = await sql.query`
            SELECT
                c.ConnectionId,
                CASE
                    WHEN c.SenderId = ${userId} THEN u2.UserId
                    ELSE u1.UserId
                END AS OtherUserId,
                CASE
                    WHEN c.SenderId = ${userId} THEN u2.FullName
                    ELSE u1.FullName
                END AS OtherUserName,
                c.Status,
                c.CreatedAt
            FROM Connections c
            INNER JOIN Users u1 ON u1.UserId = c.SenderId
            INNER JOIN Users u2 ON u2.UserId = c.ReceiverId
            WHERE c.SenderId = ${userId}
               OR c.ReceiverId = ${userId}
            ORDER BY c.CreatedAt DESC
        `;

        return res.json({
            success: true,
            connections: result.recordset
        });
    } catch (error) {
        console.error('Get connections error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Unable to get conversations.'
        });
    }
});

// POST /api/chat/connections
// Tạo hoặc lấy cuộc trò chuyện với một tài khoản khác.
router.post('/connections', authMiddleware, async (req, res) => {
    try {
        const userId = Number(req.user.userId);
        const receiverId = Number(req.body.receiverId);

        if (
            !Number.isInteger(receiverId) ||
            receiverId <= 0 ||
            receiverId === userId
        ) {
            return res.status(400).json({
                success: false,
                message: 'A valid other user ID is required.'
            });
        }

        const target = await sql.query`
            SELECT UserId, FullName
            FROM Users
            WHERE UserId = ${receiverId}
        `;

        if (target.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found.'
            });
        }

        const existing = await sql.query`
            SELECT ConnectionId, SenderId, ReceiverId, Status, CreatedAt
            FROM Connections
            WHERE (SenderId = ${userId} AND ReceiverId = ${receiverId})
               OR (SenderId = ${receiverId} AND ReceiverId = ${userId})
        `;

        if (existing.recordset.length > 0) {
            return res.json({
                success: true,
                connection: existing.recordset[0]
            });
        }

        const created = await sql.query`
            INSERT INTO Connections (SenderId, ReceiverId, Status)
            OUTPUT
                INSERTED.ConnectionId,
                INSERTED.SenderId,
                INSERTED.ReceiverId,
                INSERTED.Status,
                INSERTED.CreatedAt
            VALUES (${userId}, ${receiverId}, 'Accepted')
        `;

        return res.status(201).json({
            success: true,
            connection: created.recordset[0]
        });
    } catch (error) {
        console.error('Create connection error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Unable to create conversation.'
        });
    }
});

// GET /api/chat/:connectionId/messages
// Lấy lịch sử tin nhắn.
router.get('/:connectionId/messages', authMiddleware, async (req, res) => {
    try {
        const connectionId = Number(req.params.connectionId);

        if (!Number.isInteger(connectionId) || connectionId <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid connection ID.'
            });
        }

        const connection = await getConnection(
            connectionId,
            req.user.userId
        );

        if (!connection) {
            return res.status(403).json({
                success: false,
                message: 'You cannot access this conversation.'
            });
        }

        const result = await sql.query`
            SELECT
                m.MessageId,
                m.ConnectionId,
                m.SenderId,
                u.FullName AS SenderName,
                m.Content,
                m.SentAt
            FROM Messages m
            INNER JOIN Users u ON u.UserId = m.SenderId
            WHERE m.ConnectionId = ${connectionId}
            ORDER BY m.SentAt ASC, m.MessageId ASC
        `;

        return res.json({
            success: true,
            messages: result.recordset
        });
    } catch (error) {
        console.error('Get messages error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Unable to get messages.'
        });
    }
});

// POST /api/chat/:connectionId/messages
// Lưu tin nhắn mới.
router.post('/:connectionId/messages', authMiddleware, async (req, res) => {
    try {
        const connectionId = Number(req.params.connectionId);
        const senderId = req.user.userId;
        const content = req.body.content;

        if (!Number.isInteger(connectionId) || connectionId <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid connection ID.'
            });
        }

        if (
            typeof content !== 'string' ||
            !content.trim() ||
            content.trim().length > 5000
        ) {
            return res.status(400).json({
                success: false,
                message: 'Message must contain 1 to 5000 characters.'
            });
        }

        const connection = await getConnection(
            connectionId,
            senderId
        );

        if (!connection) {
            return res.status(403).json({
                success: false,
                message: 'You cannot send messages to this conversation.'
            });
        }

        const result = await sql.query`
            INSERT INTO Messages (ConnectionId, SenderId, Content)
            OUTPUT
                INSERTED.MessageId,
                INSERTED.ConnectionId,
                INSERTED.SenderId,
                INSERTED.Content,
                INSERTED.SentAt
            VALUES (
                ${connectionId},
                ${senderId},
                ${content.trim()}
            )
        `;

        return res.status(201).json({
            success: true,
            message: result.recordset[0]
        });
    } catch (error) {
        console.error('Send message error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Unable to send message.'
        });
    }
});

module.exports = router;
