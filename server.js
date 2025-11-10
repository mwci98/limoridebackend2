const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection error:', err);
  } else {
    console.log('✅ Connected to PostgreSQL database');
    release();
  }
});

// Create bookings table
const createBookingsTable = async () => {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        booking_id VARCHAR(50) UNIQUE NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        service_type VARCHAR(50) NOT NULL,
        vehicle_type VARCHAR(50) NOT NULL,
        pickup_date DATE NOT NULL,
        pickup_time TIME NOT NULL,
        pickup_address TEXT NOT NULL,
        destination TEXT,
        passengers INTEGER DEFAULT 1,
        miles DECIMAL(10,2),
        hours DECIMAL(10,2),
        total_amount DECIMAL(10,2) NOT NULL,
        payment_method VARCHAR(50) NOT NULL,
        payment_status VARCHAR(50) DEFAULT 'pending',
        special_requests TEXT,
        billing_address TEXT,
        stop_points JSONB,
        navigation_url TEXT,
        status VARCHAR(50) DEFAULT 'confirmed',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    await pool.query(query);
    console.log('✅ Bookings table created/verified');
  } catch (error) {
    console.error('❌ Table creation error:', error);
  }
};

// Initialize database
createBookingsTable();

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Bay Elite Backend is running',
    timestamp: new Date().toISOString()
  });
});

// Create booking endpoint
app.post('/api/bookings', async (req, res) => {
  try {
    console.log('📥 Received booking data:', req.body);
    
    const {
      bookingId,
      firstName,
      lastName,
      email,
      phone,
      serviceType,
      vehicleType,
      pickupDate,
      pickupTime,
      pickupAddress,
      destination,
      passengers = 1,
      miles = 0,
      hours = 0,
      totalAmount,
      paymentMethod,
      paymentStatus = 'pending',
      specialRequests = '',
      billingAddress = '',
      stopPoints = [],
      navigationUrl = ''
    } = req.body;

    // Validate required fields
    if (!bookingId || !firstName || !lastName || !email || !phone || !serviceType || !vehicleType || !pickupDate || !pickupTime || !pickupAddress || !totalAmount || !paymentMethod) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    const query = `
      INSERT INTO bookings (
        booking_id, first_name, last_name, email, phone,
        service_type, vehicle_type, pickup_date, pickup_time,
        pickup_address, destination, passengers, miles, hours,
        total_amount, payment_method, payment_status, special_requests,
        billing_address, stop_points, navigation_url
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      RETURNING *
    `;

    const values = [
      bookingId, firstName, lastName, email, phone,
      serviceType, vehicleType, pickupDate, pickupTime,
      pickupAddress, destination, passengers, miles, hours,
      totalAmount, paymentMethod, paymentStatus, specialRequests,
      billingAddress, JSON.stringify(stopPoints), navigationUrl
    ];

    const result = await pool.query(query, values);
    
    console.log('✅ Booking saved to database:', result.rows[0].booking_id);
    
    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      booking: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Booking creation error:', error);
    
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({
        success: false,
        error: 'Booking ID already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      error: 'Failed to create booking'
    });
  }
});

// Get booking by ID
app.get('/api/bookings/:bookingId', async (req, res) => {
  try {
    const { bookingId } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM bookings WHERE booking_id = $1',
      [bookingId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      });
    }

    res.json({
      success: true,
      booking: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Get booking error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch booking'
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Bay Elite Backend running on port ${PORT}`);
  console.log(`📊 Database: ${process.env.DATABASE_URL ? 'Connected' : 'Not configured'}`);
});