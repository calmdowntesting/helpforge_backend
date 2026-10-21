
require('dotenv').config();
const nodemailer = require('nodemailer');

async function testEmail() {
    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.MAIL_USER,
                pass: process.env.MAIL_APP_PASSWORD
            }
        });

        // Kiểm tra kết nối Gmail
        await transporter.verify();
        console.log('Ket noi Gmail thanh cong!');

        // Gửi email kiểm tra
        const info = await transporter.sendMail({
            from: `"INTENT App" <${process.env.MAIL_USER}>`,
            to: process.env.MAIL_USER,
            subject: 'INTENT - Test Gmail OTP',
            text: 'Email test thanh cong. Ban co the tiep tuc lam chuc nang quen mat khau.'
        });

        console.log('Gui email thanh cong!');
        console.log('Message ID:', info.messageId);

    } catch (error) {
        console.error('Loi gui email:', error.message);
    }
}

testEmail();
