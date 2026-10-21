
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sql } = require('./db');
const crypto = require('crypto');
const nodemailer = require('nodemailer');


const authMiddleware = require('./middleware/authMiddleware');

const router = express.Router();
const mailer = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_APP_PASSWORD
    }
});

function hashValue(value) {
    return crypto.createHash('sha256')
        .update(value)
        .digest('hex');
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
    try {
        const { fullName, email, password } = req.body;

        if (
            typeof fullName !== 'string' ||
            typeof email !== 'string' ||
            typeof password !== 'string' ||
            !fullName.trim() ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                success: false,
                message: 'Full name, email and password are required.'
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                message: 'Password must contain at least 8 characters.'
            });
        }

        const existing = await sql.query`
            SELECT UserId
            FROM Users
            WHERE Email = ${normalizedEmail}
        `;

        if (existing.recordset.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'Email is already registered.'
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const result = await sql.query`
            INSERT INTO Users (FullName, Email, PasswordHash)
            OUTPUT INSERTED.UserId, INSERTED.FullName,
                   INSERTED.Email, INSERTED.CreatedAt
            VALUES (
                ${fullName.trim()},
                ${normalizedEmail},
                ${passwordHash}
            )
        `;

        return res.status(201).json({
            success: true,
            message: 'Account created successfully.',
            user: result.recordset[0]
        });
    } catch (error) {
        console.error('Register error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Unable to register account.'
        });
    }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (
            typeof email !== 'string' ||
            typeof password !== 'string' ||
            !email.trim() ||
            !password
        ) {
            return res.status(400).json({
                success: false,
                message: 'Email and password are required.'
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const result = await sql.query`
            SELECT UserId, FullName, Email, PasswordHash
            FROM Users
            WHERE Email = ${normalizedEmail}
        `;

        if (result.recordset.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password.'
            });
        }

        const user = result.recordset[0];
        const passwordMatches = await bcrypt.compare(
            password,
            user.PasswordHash
        );

        if (!passwordMatches) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password.'
            });
        }

        if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET is not configured.');
        }

        const token = jwt.sign(
            { userId: user.UserId },
            process.env.JWT_SECRET,
            { expiresIn: '2h' }
        );

        return res.json({
            success: true,
            message: 'Login successful.',
            token,
            user: {
                userId: user.UserId,
                fullName: user.FullName,
                email: user.Email
            }
        });
    } catch (error) {
        console.error('Login error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Unable to log in.'
        });
    }
});

    // POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        if (typeof email !== 'string' || !email.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Email is required.'
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const result = await sql.query`
            SELECT UserId, FullName, Email
            FROM Users
            WHERE Email = ${normalizedEmail}
        `;

        // Không tiết lộ email có đăng ký hay không.
        if (result.recordset.length === 0) {
            return res.json({
                success: true,
                message: 'If the email is registered, an OTP will be sent.'
            });
        }

        const user = result.recordset[0];

        // Vô hiệu hóa OTP cũ chưa sử dụng.
        await sql.query`
            UPDATE PasswordResetOTPs
            SET Used = 1
            WHERE UserId = ${user.UserId}
              AND Used = 0
        `;

        const otp = crypto.randomInt(100000, 1000000).toString();
        const otpHash = hashValue(otp);

        // OTP hết hạn sau 5 phút.
        await sql.query`
            INSERT INTO PasswordResetOTPs
                (UserId, OTPHash, ExpiresAt, Attempts, Used)
            VALUES (
                ${user.UserId},
                ${otpHash},
                DATEADD(MINUTE, 5, SYSUTCDATETIME()),
                0,
                0
            )
        `;

        await mailer.sendMail({
            from: `"INTENT" <${process.env.MAIL_USER}>`,
            to: user.Email,
            subject: 'INTENT - Password Reset OTP',
            text:
                `Hello ${user.FullName},\n\n` +
                `Your password reset code is: ${otp}\n` +
                `This code expires in 5 minutes.\n` +
                `If you did not request this, ignore this email.`
        });

        return res.json({
            success: true,
            message: 'If the email is registered, an OTP will be sent.'
        });
    } catch (error) {
        console.error('Forgot password error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Unable to process the request.'
        });
    }
});

 // Kiểm tra OTP và cấp reset token
router.post('/verify-reset-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;

        if (
            typeof email !== 'string' ||
            typeof otp !== 'string' ||
            !email.trim() ||
            !/^\d{6}$/.test(otp)
        ) {
            return res.status(400).json({
                success: false,
                message: 'Valid email and 6-digit OTP are required.'
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const userResult = await sql.query`
            SELECT UserId
            FROM Users
            WHERE Email = ${normalizedEmail}
        `;

        if (userResult.recordset.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired OTP.'
            });
        }

        const userId = userResult.recordset[0].UserId;

        const otpResult = await sql.query`
            SELECT TOP 1 Id, OTPHash, Attempts
            FROM PasswordResetOTPs
            WHERE UserId = ${userId}
              AND Used = 0
              AND ExpiresAt > SYSUTCDATETIME()
              AND Attempts < 5
            ORDER BY CreatedAt DESC
        `;

        if (otpResult.recordset.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired OTP.'
            });
        }

        const record = otpResult.recordset[0];

        if (hashValue(otp) !== record.OTPHash) {
            await sql.query`
                UPDATE PasswordResetOTPs
                SET Attempts = Attempts + 1
                WHERE Id = ${record.Id}
            `;

            return res.status(400).json({
                success: false,
                message: 'Invalid or expired OTP.'
            });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenHash = hashValue(resetToken);

        await sql.query`
            UPDATE PasswordResetOTPs
            SET OTPHash = ${resetTokenHash},
                Used = 1,
                ExpiresAt = DATEADD(MINUTE, 10, SYSUTCDATETIME())
            WHERE Id = ${record.Id}
        `;

        return res.json({
            success: true,
            message: 'OTP verified successfully.',
            resetToken
        });
    } catch (error) {
        console.error('Verify OTP error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Unable to verify OTP.'
        });
    }
});


router.post('/reset-password', async (req, res) => {
    try {
        const { resetToken, newPassword } = req.body;

        if (
            typeof resetToken !== 'string' ||
            typeof newPassword !== 'string' ||
            resetToken.length !== 64 ||
            newPassword.length < 8
        ) {
            return res.status(400).json({
                success: false,
                message: 'Reset token or password is invalid.'
            });
        }

        const tokenHash = hashValue(resetToken);

        const tokenResult = await sql.query`
            SELECT TOP 1 Id, UserId
            FROM PasswordResetOTPs
            WHERE OTPHash = ${tokenHash}
              AND Used = 1
              AND ExpiresAt > SYSUTCDATETIME()
        `;

        if (tokenResult.recordset.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired reset token.'
            });
        }

        const record = tokenResult.recordset[0];
        const passwordHash = await bcrypt.hash(newPassword, 12);

        // Mark token as consumed before updating the password.
        const consumeResult = await sql.query`
            UPDATE PasswordResetOTPs
            SET ExpiresAt = SYSUTCDATETIME()
            WHERE Id = ${record.Id}
              AND OTPHash = ${tokenHash}
              AND Used = 1
              AND ExpiresAt > SYSUTCDATETIME()
        `;

        if (consumeResult.rowsAffected[0] === 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired reset token.'
            });
        }

        await sql.query`
            UPDATE Users
            SET PasswordHash = ${passwordHash}
            WHERE UserId = ${record.UserId}
        `;

        return res.json({
            success: true,
            message: 'Password reset successfully.'
        });
    } catch (error) {
        console.error('Reset password error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Unable to reset password.'
        });
    }
});



router.get('/test-route', (req, res) => {
    res.json({
        success: true,
        message: 'Auth router is working'
    });
});

router.get('/profile', authMiddleware, async (req, res) => {
    try {
        const result = await sql.query`
            SELECT UserId, FullName, Email, Major, Bio, Skills, CreatedAt
            FROM Users
            WHERE UserId = ${req.user.userId}
        `;

        if (result.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found.'
            });
        }

        return res.json({
            success: true,
            user: result.recordset[0]
        });
    } catch (error) {
        console.error('Get profile error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Unable to get profile.'
        });
    }
});

router.put('/profile', authMiddleware, async (req, res) => {
    try {
        const { fullName, major, bio, skills } = req.body;

        if (typeof fullName !== 'string' || !fullName.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Full name is required.'
            });
        }

        const result = await sql.query`
            UPDATE Users
            SET FullName = ${fullName.trim()},
                Major = ${typeof major === 'string' ? major : ''},
                Bio = ${typeof bio === 'string' ? bio : ''},
                Skills = ${typeof skills === 'string' ? skills : ''}
            WHERE UserId = ${req.user.userId};

            SELECT UserId, FullName, Email, Major, Bio, Skills, CreatedAt
            FROM Users
            WHERE UserId = ${req.user.userId};
        `;

        const user = result.recordsets?.[1]?.[0];

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found.'
            });
        }

        return res.json({
            success: true,
            message: 'Profile updated successfully.',
            user
        });
    } catch (error) {
        console.error('Update profile error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Unable to update profile.'
        });
    }
});

module.exports = router;
