
const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            message: 'Authentication token is required.'
        });
    }

    const token = authHeader.substring(7);

    try {
        if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET is not configured.');
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (!decoded.userId) {
            return res.status(401).json({
                success: false,
                message: 'Invalid authentication token.'
            });
        }

        req.user = {
            userId: decoded.userId
        };

        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired authentication token.'
        });
    }
}

module.exports = authMiddleware;
