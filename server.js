process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Debugging: Check if environment variables are loaded
console.log('🔍 Checking environment variables...');
if (!process.env.DATABASE_URL) {
  console.error('❌ FATAL: DATABASE_URL is not defined. Check your .env file.');
} else {
  // Mask password for logging
  const maskedUrl = process.env.DATABASE_URL.replace(/:([^:@]+)@/, ':****@');
  console.log(`✅ DATABASE_URL loaded: ${maskedUrl}`);
}

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
        assigned_driver_id VARCHAR(50),
        assigned_driver_name VARCHAR(100),
        otp VARCHAR(10),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await pool.query(query);

    // Migration for existing tables
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS assigned_driver_id VARCHAR(50)`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS assigned_driver_name VARCHAR(100)`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS otp VARCHAR(10)`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notification_sent BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS rating INTEGER`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS feedback TEXT`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS tip_amount DECIMAL(10,2)`);

    console.log('✅ Bookings table created/verified & columns synced');
  } catch (error) {
    console.error('❌ Table creation error:', error);
  }
};

// Create drivers table
const createDriversTable = async () => {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS drivers (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone VARCHAR(20) NOT NULL,
        vehicle VARCHAR(50) NOT NULL,
        status VARCHAR(20) DEFAULT 'available',
        current_location VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await pool.query(query);
    console.log('✅ Drivers table created/verified');
  } catch (error) {
    console.error('❌ Table creation error:', error);
  }
};

// Initialize database
createBookingsTable();
createDriversTable();

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Bay Elite Backend is running',
    timestamp: new Date().toISOString()
  });
});

// --- BOOKINGS ENDPOINTS ---

// Get ALL bookings
app.get('/api/bookings', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM bookings ORDER BY created_at DESC');
    res.json({ bookings: result.rows });
  } catch (error) {
    console.error('❌ Get all bookings error:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// Create booking endpoint
app.post('/api/bookings', async (req, res) => {
  try {
    console.log('📥 Received booking data:', req.body);

    const {
      bookingId, firstName, lastName, email, phone,
      serviceType, vehicleType, pickupDate, pickupTime,
      pickupAddress, destination, passengers = 1,
      miles = 0, hours = 0, totalAmount, paymentMethod,
      paymentStatus = 'pending', specialRequests = '',
      billingAddress = '', stopPoints = [], navigationUrl = ''
    } = req.body;

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
    res.status(500).json({ success: false, error: 'Failed to create booking' });
  }
});

// Get booking by ID
app.get('/api/bookings/:bookingId', async (req, res) => {
  try {
    const { bookingId } = req.params;
    const result = await pool.query('SELECT * FROM bookings WHERE booking_id = $1', [bookingId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    res.json({ success: true, booking: result.rows[0] });
  } catch (error) {
    console.error('❌ Get booking error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch booking' });
  }
});

// Update booking
app.put('/api/bookings/:bookingId', async (req, res) => {
  try {
    const { bookingId } = req.params;
    const updates = req.body;

    // Construct dynamic update query
    const forbiddenFields = ['id', 'booking_id', 'bookingId', 'created_at', 'updated_at', 'last_updated'];
    const validKeys = Object.keys(updates).filter(key => !forbiddenFields.includes(key));

    const setClause = validKeys
      .map((key, index) => {
        // Map keys to snake_case column names
        let dbColumn = key;
        if (key === 'bookingId') dbColumn = 'booking_id';
        if (key === 'firstName') dbColumn = 'first_name';
        if (key === 'lastName') dbColumn = 'last_name';
        if (key === 'serviceType') dbColumn = 'service_type';
        if (key === 'vehicleType') dbColumn = 'vehicle_type';
        if (key === 'pickupDate' || key === 'pickup_date') dbColumn = 'pickup_date';
        if (key === 'pickupTime' || key === 'pickuptime') dbColumn = 'pickup_time'; // FIX: pickuptime -> pickup_time
        if (key === 'pickupAddress' || key === 'pickup_address') dbColumn = 'pickup_address';
        if (key === 'totalAmount') dbColumn = 'total_amount';
        if (key === 'paymentMethod') dbColumn = 'payment_method';
        if (key === 'paymentStatus') dbColumn = 'payment_status';
        if (key === 'specialRequests' || key === 'special_requests') dbColumn = 'special_requests';
        if (key === 'billingAddress') dbColumn = 'billing_address';
        if (key === 'stopPoints') dbColumn = 'stop_points';
        if (key === 'navigationUrl') dbColumn = 'navigation_url';
        if (key === 'assignedDriverId') dbColumn = 'assigned_driver_id';
        if (key === 'assignedDriverName') dbColumn = 'assigned_driver_name';
        if (key === 'assignedDriverId') dbColumn = 'assigned_driver_id';
        if (key === 'assignedDriverName') dbColumn = 'assigned_driver_name';
        if (key === 'last_updated') dbColumn = 'updated_at';
        if (key === 'tipAmount') dbColumn = 'tip_amount';
        if (key === 'rating') dbColumn = 'rating';
        if (key === 'feedback') dbColumn = 'feedback';

        return `${dbColumn} = $${index + 2}`;
      })
      .join(', ');

    if (!setClause) return res.status(400).json({ error: 'No fields to update' });

    const values = [bookingId, ...Object.values(updates)];

    const query = `UPDATE bookings SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE booking_id = $1 RETURNING *`;

    const result = await pool.query(query, values);

    // --- EMAIL NOTIFICATION LOGIC ---
    if (updates.status === 'refund_requested') {
      try {
        console.log('📧 Attempting to send refund notification email...');
        const nodemailer = require('nodemailer');

        // Configure transporter (Replace with real credentials in .env)
        const transporter = nodemailer.createTransport({
          service: 'gmail', // or your provider
          auth: {
            user: process.env.EMAIL_USER || 'your-email@gmail.com',
            pass: process.env.EMAIL_PASS || 'your-app-password'
          }
        });

        const mailOptions = {
          from: process.env.EMAIL_USER || 'noreply@rideleaderlimo.com',
          to: process.env.OWNER_EMAIL || 'owner@rideleaderlimo.com', // Target owner email
          subject: `Refund Request - Booking ${bookingId}`,
          text: `
            Refund Request Notification
            ---------------------------
            Booking ID: ${bookingId}
            Customer: ${updates.first_name || 'Customer'} ${updates.last_name || ''}
            
            The customer has requested a cancellation and refund for this booking.
            Please review the booking in the Manager Dashboard and process the refund in Stripe/Payment Gateway.
            
            Time of Request: ${new Date().toLocaleString()}
          `
        };

        // Send email
        await transporter.sendMail(mailOptions);
        console.log('✅ Refund notification email sent successfully.');

      } catch (emailError) {
        console.error('❌ Failed to send email:', emailError);
        // Don't fail the request just because email failed, but log it
      }
    }
    // --------------------------------

    // --- RIDE COMPLETION EMAIL (Tip & Feedback) ---
    if (updates.status === 'completed') {
      try {
        console.log('📧 Attempting to send completion email...');
        const nodemailer = require('nodemailer');

        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
          }
        });

        // We need the email address. If it wasn't passed in updates, we need to fetch the booking to get it.
        let targetEmail = updates.email;
        let targetBookingId = bookingId; // Default to param

        if (!targetEmail || !targetBookingId) {
          const bookingCheck = await pool.query('SELECT email, booking_id FROM bookings WHERE booking_id = $1', [bookingId]);
          if (bookingCheck.rows.length > 0) {
            targetEmail = bookingCheck.rows[0].email;
            targetBookingId = bookingCheck.rows[0].booking_id; // Ensure we have the string ID
          }
        }

        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: targetEmail,
          subject: `How was your ride? - Ride Leader Limo`,
          text: `
            Thank you for riding with Ride Leader Limo!
            
            We hope you had a comfortable journey.
            
            We would appreciate your feedback and rating.
            
            If you enjoyed the service, tips are welcome!
            
            Rate & Tip here: http://localhost:5080/review/${targetBookingId}
            
            Thank you,
            Ride Leader Limo Team
          `
        };

        if (mailOptions.to) {
          await transporter.sendMail(mailOptions);
          console.log(`✅ Completion email sent to ${mailOptions.to}`);
        } else {
          console.log('⚠️ Could not send completion email: Customer email not found.');
        }

      } catch (emailError) {
        console.error('❌ Failed to send completion email:', emailError);
      }
    }
    // --------------------------------

    if (result.rows.length === 0) {
      // Try searching by numeric ID if booking_id (string) not found
      const resultId = await pool.query(`UPDATE bookings SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`, [bookingId, ...Object.values(updates)]);
      if (resultId.rows.length > 0) return res.json({ success: true, booking: resultId.rows[0] });

      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    return res.json({ success: true, booking: result.rows[0] });
  } catch (error) {
    console.error('❌ Update booking error:', error);
    res.status(500).json({ success: false, error: 'Failed to update booking' });
  }
});

// --- DRIVERS ENDPOINTS ---

// Get all drivers
app.get('/api/drivers', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM drivers ORDER BY name');
    res.json({ drivers: result.rows });
  } catch (error) {
    console.error('❌ Get drivers error:', error);
    res.status(500).json({ error: 'Failed to fetch drivers' });
  }
});

// Add new driver
app.post('/api/drivers', async (req, res) => {
  try {
    const { name, email, phone, vehicle, status = 'available', current_location } = req.body;
    const id = `D${Date.now()}`;

    const query = `
      INSERT INTO drivers (id, name, email, phone, vehicle, status, current_location)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const values = [id, name, email, phone, vehicle, status, current_location];

    const result = await pool.query(query, values);
    res.status(201).json({ success: true, driver: result.rows[0] });
  } catch (error) {
    console.error('❌ Add driver error:', error);
    res.status(500).json({ success: false, error: 'Failed to add driver' });
  }
});

// Update driver
app.put('/api/drivers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const setClause = Object.keys(updates)
      .map((key, index) => `${key} = $${index + 2}`)
      .join(', ');

    if (!setClause) return res.status(400).json({ error: 'No fields to update' });

    const query = `UPDATE drivers SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`;
    const values = [id, ...Object.values(updates)];

    const result = await pool.query(query, values);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Driver not found' });

    res.json({ success: true, driver: result.rows[0] });
  } catch (error) {
    console.error('❌ Update driver error:', error);
    res.status(500).json({ success: false, error: 'Failed to update driver' });
  }
});

// Delete driver
app.delete('/api/drivers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM drivers WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Driver not found' });

    res.json({ success: true, message: 'Driver deleted successfully' });
  } catch (error) {
    console.error('❌ Delete driver error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete driver' });
  }
});

// --- PAYMENT ENDPOINTS ---

app.post('/api/process-payment', async (req, res) => {
  const { sourceId, amount, currency = 'USD', idempotencyKey } = req.body;

  try {
    console.log('💳 Processing payment:', { amount, currency });

    const { Client, Environment } = require('square');

    const client = new Client({
      accessToken: process.env.SQUARE_ACCESS_TOKEN,
      environment: process.env.SQUARE_ENVIRONMENT === 'production' ? Environment.Production : Environment.Sandbox,
    });

    const { result } = await client.paymentsApi.createPayment({
      sourceId,
      idempotencyKey: idempotencyKey || `tip-${Date.now()}`,
      amountMoney: {
        amount: Math.round(amount * 100), // Convert to cents
        currency,
      },
      note: 'Driver Tip',
    });

    console.log('✅ Payment successful:', result.payment.id);
    res.json({ success: true, payment: result.payment });

  } catch (error) {
    console.error('❌ Payment processing error:', error);
    // Handle Square API errors gracefully
    const errorMessage = error.result ? JSON.stringify(error.result.errors) : error.message;
    res.status(500).json({ success: false, error: 'Payment processing failed', details: errorMessage });
  }
});

// --- SCHEDULER: Check for upcoming rides every minute ---
setInterval(async () => {
  try {
    const now = new Date();

    // Simple query getting rows that haven't been notified yet and are confirmed
    const result = await pool.query(
      `SELECT * FROM bookings 
       WHERE notification_sent = FALSE 
       AND status = 'confirmed'`
    );

    for (const booking of result.rows) {
      // FIX: Handle Date object carefully to avoid UTC shift
      let pickupDateStr;
      if (typeof booking.pickup_date === 'string') {
        pickupDateStr = booking.pickup_date.split('T')[0];
      } else {
        // Use LOCAL time parts, not UTC
        const d = booking.pickup_date;
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        pickupDateStr = `${year}-${month}-${day}`;
      }
      const pickupDateTime = new Date(`${pickupDateStr}T${booking.pickup_time}`);

      const diffMs = pickupDateTime.getTime() - now.getTime();
      const diffMinutes = diffMs / 60000;

      // DEBUG LOG
      console.log(`Checking Booking ${booking.booking_id}: Time=${booking.pickup_time}, Diff=${diffMinutes.toFixed(2)} mins, Sent=${booking.notification_sent}`);

      // Check if ride is between 15 and 45 minutes away (widened window)
      if (diffMinutes >= 15 && diffMinutes <= 45) {
        console.log(`⏰ Booking ${booking.booking_id} is upcoming (${Math.round(diffMinutes)} mins). Sending email...`);

        try {
          const nodemailer = require('nodemailer');
          const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
              user: process.env.EMAIL_USER,
              pass: process.env.EMAIL_PASS
            }
          });

          const mailOptions = {
            from: process.env.EMAIL_USER,
            to: booking.email,
            subject: `Your Ride is Coming Up! - Ride Leader Limo`,
            text: `
              Hello ${booking.first_name},
              
              This is a reminder that your ride is scheduled for ${booking.pickup_time.substring(0, 5)} (in ~30 minutes).
              
              Pickup: ${booking.pickup_address}
              
              Your chauffeur will arrive shortly.
              
              Thank you for choosing Ride Leader Limo.
            `
          };

          await transporter.sendMail(mailOptions);
          console.log(`✅ Pre-ride email sent to ${booking.email}`);

          // Mark as sent
          await pool.query('UPDATE bookings SET notification_sent = TRUE WHERE id = $1', [booking.id]);

        } catch (mailErr) {
          console.error(`❌ Failed to send pre-ride email for ${booking.booking_id}:`, mailErr);
        }
      }
    }
  } catch (err) {
    console.error('❌ Scheduler error:', err);
  }
}, 60 * 1000); // Run every 60 seconds

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Bay Elite Backend running on port ${PORT}`);
  console.log(`📊 Database: ${process.env.DATABASE_URL ? 'Connected' : 'Not configured'}`);
});

// Prevent server crash on unhandled errors (like DB connection reset)
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  // Keep the server running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Keep the server running
});
