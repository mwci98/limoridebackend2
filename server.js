process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

const DEFAULT_RESEND_FROM = 'Ride Leader Limo <noreply@limorideleader.com>';
const configuredResendFrom =
  process.env.RESEND_FROM ||
  process.env.RESEND_FROM_EMAIL ||
  process.env.EMAIL_FROM;
const RESEND_FROM = configuredResendFrom
  ? (configuredResendFrom.includes('<')
      ? configuredResendFrom
      : `Ride Leader Limo <${configuredResendFrom}>`)
  : DEFAULT_RESEND_FROM;
const SMTP_EMAIL = process.env.EMAIL_USER;
const SMTP_PASSWORD = process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD;
const SMTP_FROM = SMTP_EMAIL ? `Ride Leader Limo <${SMTP_EMAIL}>` : DEFAULT_RESEND_FROM;

const sendOtpEmail = async ({ to, otp, html }) => {
  const subject = `${otp} is your verification code`;
  const text = `Your Ride Leader Limo verification code is ${otp}. It expires in 10 minutes.`;
  let resendError = null;

  if (process.env.RESEND_API_KEY) {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [to],
        subject,
        html
      })
    });

    const resendData = await resendRes.json();
    console.log('📧 Resend Response for', to, ':', JSON.stringify(resendData));

    if (resendRes.ok) {
      return { provider: 'resend' };
    }

    resendError = new Error(`Resend API error: ${JSON.stringify(resendData)}`);
    console.warn('Resend OTP send failed, checking SMTP fallback...');
  }

  if (SMTP_EMAIL && SMTP_PASSWORD) {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: SMTP_EMAIL,
        pass: SMTP_PASSWORD
      }
    });

    await transporter.sendMail({
      from: SMTP_FROM,
      to,
      subject,
      text,
      html
    });

    return { provider: 'smtp', fallback: Boolean(resendError) };
  }

  if (resendError) {
    throw resendError;
  }

  return { provider: 'dev' };
};

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

const DEFAULT_PRICING_SETTINGS = {
  hourly: {
    rates: {
      sedan: 125,
      suv: 125,
      sprinter: 200
    },
    minimumHours: 4,
    includedMiles: 70,
    quickQuoteDistanceDivisor: 22.5,
    quickQuoteMinimumMilesBaseline: 90,
    displayMinimumHours: {
      sedan: 4,
      suv: 4,
      sprinter: 6
    }
  },
  pointToPoint: {
    rates: {
      sedan: 6.5,
      suv: 6.5,
      sprinter: 12
    },
    minimumMiles: {
      sedan: 16,
      suv: 16,
      sprinter: 9
    }
  },
  packages: {
    weddingSubtotal: 600,
    corporateSubtotal: 250,
    gratuityRate: 0.2
  }
};

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
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        booking_type VARCHAR(20) DEFAULT 'individual',
        company_name VARCHAR(150),
        gstin VARCHAR(50),
        id_card_data TEXT,
        payment_id VARCHAR(100)
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
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ride_started_at TIMESTAMP`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS mid_ride_review_sent BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS post_ride_review_sent BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_type VARCHAR(20) DEFAULT 'individual'`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS company_name VARCHAR(150)`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS gstin VARCHAR(50)`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS id_card_data TEXT`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_id VARCHAR(100)`);
    
    // Auth OTPs Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth_otps (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        otp VARCHAR(10) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
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

const createVehiclesTable = async () => {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS vehicles (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        image TEXT NOT NULL,
        seats VARCHAR(100),
        luggage VARCHAR(100),
        amenities JSONB DEFAULT '[]'::jsonb,
        description TEXT NOT NULL,
        category VARCHAR(100) DEFAULT 'executive',
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await pool.query(query);

    const countResult = await pool.query('SELECT COUNT(*)::int AS count FROM vehicles');
    if (countResult.rows[0].count === 0) {
      await pool.query(
        `
          INSERT INTO vehicles (name, image, seats, luggage, amenities, description, category, active)
          VALUES
            ($1, $2, $3, $4, $5::jsonb, $6, $7, TRUE),
            ($8, $9, $10, $11, $12::jsonb, $13, $14, TRUE),
            ($15, $16, $17, $18, $19::jsonb, $20, $21, TRUE)
        `,
        [
          'Luxury Sedan',
          'https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1200&q=80',
          '3 passengers',
          '3 large bags',
          JSON.stringify(['Premium leather', 'Climate control', 'Phone chargers', 'Bottled water']),
          'Perfect for airport transfers and business meetings with executive comfort.',
          'executive',
          'Premium SUV',
          'https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?auto=format&fit=crop&w=1200&q=80',
          '6 passengers',
          '6 large bags',
          JSON.stringify(['Spacious interior', 'Entertainment system', 'WiFi hotspot', 'Refreshments']),
          'Ideal for groups and families with extra space and luxury amenities.',
          'executive',
          'Executive Sprinter',
          'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=1200&q=80',
          '14 passengers',
          '14 large bags',
          JSON.stringify(['Conference seating', 'WiFi & charging', 'Bar service', 'Privacy partition']),
          'Perfect for corporate groups, weddings, and special events requiring group transport.',
          'executive'
        ]
      );
    }

    console.log('✅ Vehicles table created/verified');
  } catch (error) {
    console.error('❌ Vehicles table creation error:', error);
  }
};

const createPricingSettingsTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pricing_settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        settings JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT pricing_settings_single_row CHECK (id = 1)
      )
    `);

    await pool.query(
      `
        INSERT INTO pricing_settings (id, settings)
        VALUES (1, $1::jsonb)
        ON CONFLICT (id) DO NOTHING
      `,
      [JSON.stringify(DEFAULT_PRICING_SETTINGS)]
    );

    console.log('✅ Pricing settings table created/verified');
  } catch (error) {
    console.error('❌ Pricing settings table error:', error);
  }
};

// Initialize database
createBookingsTable();
createDriversTable();
createVehiclesTable();
createPricingSettingsTable();

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT 1 AS db_check');

    res.json({
      status: 'OK',
      message: 'Bay Elite Backend is running',
      database: 'connected',
      db_check: result.rows[0].db_check,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Health DB check failed:', error.message);

    res.status(500).json({
      status: 'ERROR',
      message: 'Backend running but database disconnected',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
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
      billingAddress = '', stopPoints = [], navigationUrl = '',
      bookingType = 'individual', companyName = '', gstin = '', idCardData = '', paymentId = null
    } = req.body;

    const query = `
      INSERT INTO bookings (
        booking_id, first_name, last_name, email, phone,
        service_type, vehicle_type, pickup_date, pickup_time,
        pickup_address, destination, passengers, miles, hours,
        total_amount, payment_method, payment_status, special_requests,
        billing_address, stop_points, navigation_url,
        booking_type, company_name, gstin, id_card_data, payment_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
      RETURNING *
    `;

    const values = [
      bookingId, firstName, lastName, email, phone,
      serviceType, vehicleType, pickupDate, pickupTime,
      pickupAddress, destination, passengers, miles, hours,
      totalAmount, paymentMethod, paymentStatus, specialRequests,
      billingAddress, JSON.stringify(stopPoints), navigationUrl,
      bookingType, companyName, gstin, idCardData, paymentId
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

// Get public reviews for homepage
app.get('/api/public-reviews', async (req, res) => {
  try {
    const query = `
      SELECT first_name, last_name, rating, feedback, pickup_date
      FROM bookings 
      WHERE show_on_homepage = true AND rating IS NOT NULL
      ORDER BY pickup_date DESC
      LIMIT 10
    `;
    const result = await pool.query(query);
    res.json({ success: true, reviews: result.rows });
  } catch (error) {
    console.error('❌ Get public reviews error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch reviews' });
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

    if (validKeys.length === 0) return res.status(400).json({ error: 'No fields to update' });

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
        if (key === 'pickupTime' || key === 'pickup_time' || key === 'pickuptime') dbColumn = 'pickup_time';
        if (key === 'pickupAddress' || key === 'pickup_address') dbColumn = 'pickup_address';
        if (key === 'totalAmount') dbColumn = 'total_amount';
        if (key === 'paymentMethod') dbColumn = 'payment_method';
        if (key === 'paymentStatus') dbColumn = 'payment_status';
        if (key === 'specialRequests' || key === 'special_requests') dbColumn = 'special_requests';
        if (key === 'billingAddress') dbColumn = 'billing_address';
        if (key === 'stopPoints') dbColumn = 'stop_points';
        if (key === 'navigationUrl') dbColumn = 'navigation_url';
        if (key === 'bookingType') dbColumn = 'booking_type';
        if (key === 'companyName') dbColumn = 'company_name';
        if (key === 'gstin') dbColumn = 'gstin';
        if (key === 'idCardData') dbColumn = 'id_card_data';
        if (key === 'paymentId') dbColumn = 'payment_id';
        if (key === 'assignedDriverId') dbColumn = 'assigned_driver_id';
        if (key === 'assignedDriverName') dbColumn = 'assigned_driver_name';
        if (key === 'tipAmount' || key === 'tip_amount') dbColumn = 'tip_amount';
        if (key === 'rating') dbColumn = 'rating';
        if (key === 'feedback') dbColumn = 'feedback';
        if (key === 'showOnHomepage' || key === 'show_on_homepage') dbColumn = 'show_on_homepage';

        return `${dbColumn} = $${index + 2}`;
      })
      .join(', ');

    // CRITICAL: Ensure values order matches placeholders ($2, $3, etc.)
    const values = [bookingId, ...validKeys.map(key => updates[key])];

    let additionalSets = '';
    if (updates.status === 'started') {
      additionalSets = ', ride_started_at = CURRENT_TIMESTAMP';
    }

    const query = `UPDATE bookings SET ${setClause}${additionalSets}, updated_at = CURRENT_TIMESTAMP WHERE booking_id = $1 RETURNING *`;

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
          from: process.env.EMAIL_USER || 'noreply@limorideleader.com',
          to: process.env.OWNER_EMAIL || 'owner@limorideleader.com', // Target owner email
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

    // --- CONTINUED LOGIC ---
    // Note: Ride completion Tip/Review emails have been migrated to the background automation scheduler.

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

// --- AUTH / OTP ENDPOINTS ---

app.post('/api/auth/send-otp', async (req, res) => {
  const { email, type } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    console.log('Send OTP hit for:', email, 'API Key exists:', !!process.env.RESEND_API_KEY);

    if (email.toLowerCase().endsWith('@example.com')) {
      return res.json({ success: true, bypass: true, message: 'OTP bypass granted for @example.com' });
    }

    if (type === 'driver') {
      const driverRes = await pool.query('SELECT * FROM drivers WHERE email = $1', [email]);
      if (driverRes.rows.length === 0) return res.status(404).json({ error: 'Driver email not registered' });
    } else if (type === 'customer') {
      const bookingRes = await pool.query('SELECT * FROM bookings WHERE email = $1 LIMIT 1', [email]);
      if (bookingRes.rows.length === 0) return res.status(404).json({ error: 'No bookings found for this email' });
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60000);

    await pool.query('DELETE FROM auth_otps WHERE email = $1', [email]);
    await pool.query('INSERT INTO auth_otps (email, otp, expires_at) VALUES ($1, $2, $3)', [email, otp, expiresAt]);

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #000; text-align: center;">Ride Leader Limo</h2>
        <p style="font-size: 16px;">Hello,</p>
        <p style="font-size: 16px;">Your verification code for logging into your dashboard is:</p>
        <div style="text-align: center; margin: 30px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; background: #f4f4f4; padding: 10px 20px; border-radius: 5px; color: #000;">${otp}</span>
        </div>
        <p style="font-size: 14px; color: #666;">This code will expire in 10 minutes. If you did not request this code, please ignore this email.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">&copy; 2026 Ride Leader Limo Service</p>
      </div>
    `;

    const delivery = await sendOtpEmail({ to: email, otp, html });

    if (delivery.provider === 'dev') {
      console.warn('No email provider configured, OTP is:', otp);
      return res.json({ success: true, message: 'OTP generated (Dev Mode: check logs)', devOtp: otp });
    }

    return res.json({ success: true, message: 'OTP sent successfully' });
  } catch (error) {
    console.error('Send OTP error:', error);
    return res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// --- VEHICLES ENDPOINTS ---

app.get('/api/vehicles', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM vehicles ORDER BY created_at ASC');
    res.json({ vehicles: result.rows });
  } catch (error) {
    console.error('❌ Get vehicles error:', error);
    res.status(500).json({ error: 'Failed to fetch vehicles' });
  }
});

app.post('/api/vehicles', async (req, res) => {
  try {
    const {
      name,
      image,
      seats = '',
      luggage = '',
      amenities = [],
      description,
      category = 'executive',
      active = true
    } = req.body;

    const result = await pool.query(
      `
        INSERT INTO vehicles (name, image, seats, luggage, amenities, description, category, active)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
        RETURNING *
      `,
      [name, image, seats, luggage, JSON.stringify(amenities), description, category, active]
    );

    res.status(201).json({ success: true, vehicle: result.rows[0] });
  } catch (error) {
    console.error('❌ Add vehicle error:', error);
    res.status(500).json({ success: false, error: 'Failed to add vehicle' });
  }
});

app.put('/api/vehicles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      image,
      seats = '',
      luggage = '',
      amenities = [],
      description,
      category = 'executive',
      active = true
    } = req.body;

    const result = await pool.query(
      `
        UPDATE vehicles
        SET name = $2,
            image = $3,
            seats = $4,
            luggage = $5,
            amenities = $6::jsonb,
            description = $7,
            category = $8,
            active = $9,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [id, name, image, seats, luggage, JSON.stringify(amenities), description, category, active]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    res.json({ success: true, vehicle: result.rows[0] });
  } catch (error) {
    console.error('❌ Update vehicle error:', error);
    res.status(500).json({ success: false, error: 'Failed to update vehicle' });
  }
});

app.delete('/api/vehicles/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM vehicles WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    res.json({ success: true, message: 'Vehicle deleted successfully' });
  } catch (error) {
    console.error('❌ Delete vehicle error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete vehicle' });
  }
});

app.get('/api/pricing-settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT settings FROM pricing_settings WHERE id = 1');
    const settings = result.rows[0]?.settings || DEFAULT_PRICING_SETTINGS;
    res.json({ settings });
  } catch (error) {
    console.error('❌ Get pricing settings error:', error);
    res.status(500).json({ error: 'Failed to fetch pricing settings' });
  }
});

app.put('/api/pricing-settings', async (req, res) => {
  try {
    const settings = req.body?.settings;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Valid pricing settings are required' });
    }

    const result = await pool.query(
      `
        INSERT INTO pricing_settings (id, settings, updated_at)
        VALUES (1, $1::jsonb, CURRENT_TIMESTAMP)
        ON CONFLICT (id)
        DO UPDATE SET settings = EXCLUDED.settings, updated_at = CURRENT_TIMESTAMP
        RETURNING settings
      `,
      [JSON.stringify(settings)]
    );

    res.json({
      message: 'Pricing settings updated successfully',
      settings: result.rows[0].settings
    });
  } catch (error) {
    console.error('❌ Update pricing settings error:', error);
    res.status(500).json({ error: 'Failed to update pricing settings' });
  }
});

app.post('/api/auth/send-otp-legacy', async (req, res) => {
  const { email, type } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    console.log('📧 Send OTP hit for:', email, 'API Key exists:', !!process.env.RESEND_API_KEY);
    // 1. Check for bypass FIRST
    if (email.toLowerCase().endsWith('@example.com')) {
      return res.json({ success: true, bypass: true, message: 'OTP bypass granted for @example.com' });
    }

    // 2. Check if user exists
    if (type === 'driver') {
      const driverRes = await pool.query('SELECT * FROM drivers WHERE email = $1', [email]);
      if (driverRes.rows.length === 0) return res.status(404).json({ error: 'Driver email not registered' });
    } else if (type === 'customer') {
      const bookingRes = await pool.query('SELECT * FROM bookings WHERE email = $1 LIMIT 1', [email]);
      if (bookingRes.rows.length === 0) return res.status(404).json({ error: 'No bookings found for this email' });
    }

    // 3. Generate 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60000); // 10 minutes

    // 4. Store OTP (Clean up old ones for this email first)
    await pool.query('DELETE FROM auth_otps WHERE email = $1', [email]);
    await pool.query('INSERT INTO auth_otps (email, otp, expires_at) VALUES ($1, $2, $3)', [email, otp, expiresAt]);

    // 5. Send Email
    if (!process.env.RESEND_API_KEY) {
       console.warn('⚠️ RESEND_API_KEY missing, OTP is:', otp);
       return res.json({ success: true, message: 'OTP generated (Dev Mode: check logs)', devOtp: otp });
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #000; text-align: center;">Ride Leader Limo</h2>
        <p style="font-size: 16px;">Hello,</p>
        <p style="font-size: 16px;">Your verification code for logging into your dashboard is:</p>
        <div style="text-align: center; margin: 30px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; background: #f4f4f4; padding: 10px 20px; border-radius: 5px; color: #000;">${otp}</span>
        </div>
        <p style="font-size: 14px; color: #666;">This code will expire in 10 minutes. If you did not request this code, please ignore this email.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 12px; color: #999; text-align: center;">&copy; 2026 Ride Leader Limo Service</p>
      </div>
    `;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [email],
        subject: `${otp} is your verification code`,
        html: html
      })
    });

    const resendData = await resendRes.json();
    console.log('📧 Resend Response for', email, ':', JSON.stringify(resendData));

    if (!resendRes.ok) {
        throw new Error(`Resend API error: ${JSON.stringify(resendData)}`);
    }

    res.json({ success: true, message: 'OTP sent successfully' });

  } catch (error) {
    console.error('❌ Send OTP error:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

app.post('/api/auth/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

  try {
    const result = await pool.query(
      'SELECT * FROM auth_otps WHERE email = $1 AND otp = $2 AND expires_at > CURRENT_TIMESTAMP',
      [email, otp]
    );

    if (result.rows.length > 0) {
      // Success - Delete OTP after use
      await pool.query('DELETE FROM auth_otps WHERE email = $1', [email]);
      res.json({ success: true, message: 'Verification successful' });
    } else {
      res.status(401).json({ error: 'Invalid or expired OTP' });
    }
  } catch (error) {
    console.error('❌ Verify OTP error:', error);
    res.status(500).json({ error: 'Verification failed' });
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

app.post('/api/refund-payment', async (req, res) => {
  const { bookingId } = req.body;
  try {
    let bookingQuery = await pool.query('SELECT total_amount, payment_id FROM bookings WHERE booking_id = $1', [bookingId]);
    if (bookingQuery.rows.length === 0) {
      bookingQuery = await pool.query('SELECT total_amount, payment_id FROM bookings WHERE id = $1', [bookingId]);
      if (bookingQuery.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    }
    const booking = bookingQuery.rows[0];
    
    if (!booking.payment_id) {
       return res.status(400).json({ error: 'No Square payment ID found for this booking. Please refund manually in the Square Dashboard.' });
    }

    const { Client, Environment } = require('square');
    const client = new Client({
      accessToken: process.env.SQUARE_ACCESS_TOKEN,
      environment: process.env.SQUARE_ENVIRONMENT === 'production' ? Environment.Production : Environment.Sandbox,
    });

    const idempotencyKey = `refund-${bookingId}-${Date.now()}`;
    const amountMoney = {
      amount: Math.round(Number(booking.total_amount) * 100),
      currency: 'USD'
    };

    const { result } = await client.refundsApi.refundPayment({
      idempotencyKey,
      amountMoney,
      paymentId: booking.payment_id
    });

    console.log(`✅ Refund successful for booking ${bookingId}`);
    res.json({ success: true, refund: result.refund });
  } catch (error) {
    console.error('❌ Refund error:', error);
    const errorMessage = error.result ? JSON.stringify(error.result.errors) : error.message;
    res.status(500).json({ success: false, error: 'Refund failed', details: errorMessage });
  }
});

app.post('/api/send-booking-emails', async (req, res) => {
  const { customerEmailParams, ownerEmailParams } = req.body;
  
  if (!process.env.RESEND_API_KEY) {
    console.error('❌ RESEND_API_KEY is not defined. Cannot send emails.');
    return res.status(500).json({ success: false, error: 'Email service not configured.' });
  }

  try {
    // Customer HTML Email
    const customerHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; padding: 20px; border: 1px solid #eaeaea; border-radius: 8px;">
        <div style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #eaeaea; margin-bottom: 20px;">
          <h1 style="color: #000; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">Ride Leader Limo</h1>
          <p style="color: #666; margin-top: 5px; font-size: 14px;">Your Premium Transportation Partner</p>
        </div>
        
        <h2 style="font-size: 20px; color: #111;">Booking Confirmation</h2>
        <p style="font-size: 16px; line-height: 1.5;">Hi <strong>${customerEmailParams.customer_name}</strong>,</p>
        <p style="font-size: 16px; line-height: 1.5;">Thank you for choosing Ride Leader Limo! Your booking request has been securely received. Below are the details of your upcoming ride.</p>
        
        <div style="background-color: #f9fafb; padding: 20px; border-radius: 6px; margin: 20px 0; border: 1px solid #f3f4f6;">
          <p style="margin: 0 0 12px 0; font-size: 15px;"><strong>Booking ID:</strong> <span style="color: #000;">#${customerEmailParams.booking_id}</span></p>
          <p style="margin: 0 0 12px 0; font-size: 15px;"><strong>Service:</strong> ${customerEmailParams.service_type} (${customerEmailParams.vehicle_type})</p>
          <p style="margin: 0 0 12px 0; font-size: 15px;"><strong>Date & Time:</strong> ${customerEmailParams.pickup_date} at ${customerEmailParams.pickup_time}</p>
          <p style="margin: 0 0 12px 0; font-size: 15px;"><strong>Pickup:</strong> ${customerEmailParams.pickup_address}</p>
          <p style="margin: 0 0 12px 0; font-size: 15px;"><strong>Destination:</strong> ${customerEmailParams.destination}</p>
          <p style="margin: 0 0 0 0; font-size: 15px;"><strong>Total Price:</strong> <span style="color: #10b981; font-weight: bold; font-size: 16px;">${customerEmailParams.total_amount}</span> (${customerEmailParams.payment_method})</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${customerEmailParams.frontendUrl}/customer/${customerEmailParams.booking_id}" style="background-color: #000; color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 16px;">Manage Your Booking</a>
        </div>

        <p style="font-size: 14px; color: #666; text-align: center; border-top: 1px solid #eaeaea; padding-top: 20px; line-height: 1.5;">
          We will contact you shortly for final confirmation. If you have any questions, feel free to reply directly to this email!
        </p>
      </div>
    `;

    // Owner HTML Email
    const ownerHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; padding: 20px; border: 1px solid #fca5a5; border-radius: 8px;">
        <div style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #fee2e2; margin-bottom: 20px; background-color: #fef2f2; padding: 20px; border-radius: 6px;">
          <h1 style="color: #dc2626; margin: 0; font-size: 24px; font-weight: 700;">🚨 New Booking Alert</h1>
          <p style="color: #991b1b; margin-top: 8px; font-size: 15px; font-weight: bold;">Booking ID: #${ownerEmailParams.booking_id}</p>
        </div>
        
        <h3 style="font-size: 18px; color: #111; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 5px;">Customer Details</h3>
        <p style="margin: 0 0 8px 0; font-size: 15px;"><strong>Name:</strong> ${ownerEmailParams.customer_name}</p>
        <p style="margin: 0 0 8px 0; font-size: 15px;"><strong>Email:</strong> <a href="mailto:${ownerEmailParams.customer_email}" style="color: #2563eb;">${ownerEmailParams.customer_email}</a></p>
        <p style="margin: 0 0 20px 0; font-size: 15px;"><strong>Phone:</strong> ${ownerEmailParams.customer_phone}</p>
        
        <h3 style="font-size: 18px; color: #111; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 5px;">Trip Details</h3>
        <div style="background-color: #f9fafb; padding: 15px; border-radius: 6px; margin-bottom: 20px; border: 1px solid #f3f4f6;">
          <p style="margin: 0 0 10px 0; font-size: 15px;"><strong>Service:</strong> ${ownerEmailParams.service_type} (${ownerEmailParams.vehicle_type})</p>
          <p style="margin: 0 0 10px 0; font-size: 15px;"><strong>Date & Time:</strong> ${ownerEmailParams.pickup_date} at ${ownerEmailParams.pickup_time}</p>
          <p style="margin: 0 0 10px 0; font-size: 15px;"><strong>Pickup:</strong> ${ownerEmailParams.pickup_address}</p>
          <p style="margin: 0 0 10px 0; font-size: 15px;"><strong>Destination:</strong> ${ownerEmailParams.destination}</p>
          <p style="margin: 0 0 10px 0; font-size: 15px;"><strong>Passengers:</strong> ${ownerEmailParams.passengers}</p>
          <p style="margin: 0 0 0 0; font-size: 15px;"><strong>Special Requests:</strong> ${ownerEmailParams.special_requests}</p>
        </div>

        <div style="border-top: 2px dashed #e5e7eb; padding-top: 15px; margin-bottom: 25px;">
          <p style="margin: 0; font-size: 18px;"><strong>Total Expected:</strong> <span style="color: #10b981; font-weight: bold;">${ownerEmailParams.total_amount}</span> (${ownerEmailParams.payment_method})</p>
        </div>
        
        <div style="text-align: center;">
          <a href="${customerEmailParams.frontendUrl}/admin" style="background-color: #dc2626; color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 16px;">Open Manager Dashboard</a>
        </div>
      </div>
    `;

    // Fire both emails in parallel via the Resend API
    const response = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([
        {
          from: RESEND_FROM,
          to: [customerEmailParams.customer_email],
          subject: `Booking Confirmation - ${customerEmailParams.booking_id}`,
          html: customerHtml
        },
        {
          from: RESEND_FROM,
          to: [process.env.OWNER_EMAIL || ownerEmailParams.to_email],
          subject: `NEW BOOKING - ${ownerEmailParams.booking_id}`,
          html: ownerHtml
        }
      ])
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Resend API Error:', errorText);
      throw new Error('Failed to send emails via Resend');
    }

    const data = await response.json();
    console.log('✅ Emails successfully submitted to Resend', data);
    res.json({ success: true, data });

  } catch (error) {
    console.error('❌ Send email catch error:', error);
    res.status(500).json({ success: false, error: 'Failed to send emails.' });
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
          const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; padding: 20px; border: 1px solid #eaeaea; border-radius: 8px;">
              <div style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #eaeaea; margin-bottom: 20px;">
                <h1 style="color: #000; margin: 0; font-size: 24px; font-weight: 700;">Ride Leader Limo</h1>
              </div>
              <h2 style="font-size: 20px; color: #111;">Your Ride is Coming Up! ⏰</h2>
              <p style="font-size: 16px; line-height: 1.5;">Hi <strong>${booking.first_name}</strong>,</p>
              <p style="font-size: 16px; line-height: 1.5;">This is a friendly reminder that your premium transportation is scheduled for today at <strong>${booking.pickup_time.substring(0, 5)}</strong>.</p>
              
              <div style="background-color: #f9fafb; padding: 20px; border-radius: 6px; margin: 20px 0; border: 1px solid #f3f4f6;">
                <p style="margin: 0; font-size: 15px;"><strong>Pickup Address:</strong><br/>${booking.pickup_address}</p>
              </div>

              <p style="font-size: 16px; line-height: 1.5;">Your chauffeur will be arriving shortly. We look forward to providing you with an exceptional journey.</p>
              
              <p style="font-size: 14px; color: #666; text-align: center; border-top: 1px solid #eaeaea; padding-top: 20px; margin-top: 30px;">
                Thank you for choosing Ride Leader Limo.
              </p>
            </div>
          `;

          const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: RESEND_FROM,
              to: [booking.email],
              subject: 'Your Ride is Coming Up! - Ride Leader Limo',
              html: html
            })
          });

          if (response.ok) {
            console.log(`✅ Pre-ride email sent to ${booking.email}`);
            // Mark as sent
            await pool.query('UPDATE bookings SET notification_sent = TRUE WHERE id = $1', [booking.id]);
          } else {
            console.error('❌ Resend failed for pre-ride email');
          }

        } catch (mailErr) {
          console.error(`❌ Failed to send pre-ride email for ${booking.booking_id}:`, mailErr);
        }
      }
    }
  } catch (err) {
    console.error('❌ Scheduler error:', err);
  }
}, 60 * 1000); // Run every 60 seconds

// --- SCHEDULER: Check for Review Automations every minute ---
setInterval(async () => {
  try {
    const now = new Date();

    const result = await pool.query(
      `SELECT * FROM bookings 
       WHERE (mid_ride_review_sent = FALSE AND status = 'started' AND ride_started_at IS NOT NULL)
       OR (post_ride_review_sent = FALSE AND status = 'completed')`
    );

    for (const booking of result.rows) {
      // 1. Check Mid-Ride (10-15 min elapsed)
      if (booking.status === 'started' && !booking.mid_ride_review_sent && booking.ride_started_at) {
        const startedAt = new Date(booking.ride_started_at);
        const diffMs = now.getTime() - startedAt.getTime();
        const diffMinutes = diffMs / 60000;

        if (diffMinutes >= 10 && diffMinutes <= 30) {
          console.log(`⏰ Booking ${booking.booking_id} Mid-Ride target reached. Sending review check-in...`);
          
          const frontendUrl = 'https://limorideleader.com';

          const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; padding: 20px; border: 1px solid #eaeaea; border-radius: 8px;">
              <h2 style="font-size: 20px; color: #111;">Checking In on Your Ride 🚗</h2>
              <p style="font-size: 16px; line-height: 1.5;">Hi <strong>${booking.first_name}</strong>,</p>
              <p style="font-size: 16px; line-height: 1.5;">We notice your ride with <strong>${booking.assigned_driver_name || 'your chauffeur'}</strong> is currently underway!</p>
              <p style="font-size: 16px; line-height: 1.5;">We'd love to know how your experience is so far. Feel free to leave a quick rating below!</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${frontendUrl}/review/${booking.booking_id}" style="background-color: #000; color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 16px;">Rate Your Ride Now</a>
              </div>
            </div>
          `;

          try {
             const response = await fetch('https://api.resend.com/emails', {
               method: 'POST',
               headers: { 
                 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 
                 'Content-Type': 'application/json' 
               },
               body: JSON.stringify({
                 from: RESEND_FROM,
                 to: [booking.email],
                 subject: 'How is your ride going? - Ride Leader Limo',
                 html: html
               })
             });
             if (response.ok) {
               await pool.query('UPDATE bookings SET mid_ride_review_sent = TRUE WHERE id = $1', [booking.id]);
             }
          } catch(err) { console.error('Error sending mid-ride email:', err); }
        }
      }

      // 2. Check Post-Ride Completed
      if (booking.status === 'completed' && !booking.post_ride_review_sent) {
        if (booking.rating !== null && booking.rating > 0) {
           // Already rated mid-ride, flag it so we don't spam.
           await pool.query('UPDATE bookings SET post_ride_review_sent = TRUE WHERE id = $1', [booking.id]);
           continue;
        }

        console.log(`⏰ Booking ${booking.booking_id} Completed. Sending tip/review email...`);
        const frontendUrl = 'https://limorideleader.com';
        
        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; padding: 20px; border: 1px solid #eaeaea; border-radius: 8px;">
              <h2 style="font-size: 20px; color: #111;">Thank You For Riding With Us! ✨</h2>
              <p style="font-size: 16px; line-height: 1.5;">Hi <strong>${booking.first_name}</strong>,</p>
              <p style="font-size: 16px; line-height: 1.5;">Your trip to <strong>${booking.destination || 'your destination'}</strong> is now complete.</p>
              <p style="font-size: 16px; line-height: 1.5;">We hope you had an exceptional experience. If you enjoyed the ride, please consider leaving a tip for your chauffeur!</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${frontendUrl}/review/${booking.booking_id}" style="background-color: #10b981; color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 16px;">Leave a Tip & Rating</a>
              </div>
            </div>
        `;

        try {
           const response = await fetch('https://api.resend.com/emails', {
             method: 'POST',
             headers: { 
               'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 
               'Content-Type': 'application/json' 
             },
             body: JSON.stringify({
               from: RESEND_FROM,
               to: [booking.email],
               subject: 'Thank you for riding with Ride Leader Limo',
               html: html
             })
           });
           if (response.ok) {
             await pool.query('UPDATE bookings SET post_ride_review_sent = TRUE WHERE id = $1', [booking.id]);
           }
        } catch(err) { console.error('Error sending post-ride email:', err); }
      }
    }
  } catch (err) {
    console.error('❌ Automation Scheduler error:', err);
  }
}, 60 * 1000);

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
