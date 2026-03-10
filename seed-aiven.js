process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Pool } = require('pg');

const DATABASE_URL = 'postgres://avnadmin:AVNS_AUD7MOHwp8nfNdHRaCJ@pg-d89b435-mwci98-1137.l.aivencloud.com:17316/defaultdb?sslmode=require';

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

const generateId = (prefix) => `${prefix}${Math.floor(Date.now() / 1000)}-${Math.floor(Math.random() * 1000)}`;

const createBookingsTable = async () => {
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
      notification_sent BOOLEAN DEFAULT FALSE,
      rating INTEGER,
      feedback TEXT,
      tip_amount DECIMAL(10,2)
    )
  `;
    await pool.query(query);
    console.log('✅ Bookings table created/verified');
};

const createDriversTable = async () => {
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
};

const insertData = async () => {
    try {
        const d1 = `D${Date.now()}-1`;
        const d2 = `D${Date.now()}-2`;
        const d3 = `D${Date.now()}-3`;

        // 1. Insert Drivers
        const driverQuery = `
      INSERT INTO drivers (id, name, email, phone, vehicle, status, current_location)
      VALUES 
      ($1, 'John Smith', 'john.smith@example.com', '555-0100', 'Luxury Sedan', 'available', 'SFO Airport'),
      ($2, 'Sarah Jenkins', 'sarah.j@example.com', '555-0101', 'Premium SUV', 'on_trip', 'Downtown SF'),
      ($3, 'Mike Ross', 'mike.r@example.com', '555-0102', 'Sprinter Van', 'offline', 'Palo Alto')
      ON CONFLICT (email) DO NOTHING;
    `;
        await pool.query(driverQuery, [d1, d2, d3]);
        console.log('✅ Demo drivers inserted');

        // Helper for date formatting
        const formatDate = (date) => date.toISOString().split('T')[0];
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const nextWeek = new Date(today);
        nextWeek.setDate(nextWeek.getDate() + 7);

        // 2. Insert Bookings
        const bookingQuery = `
      INSERT INTO bookings (
        booking_id, first_name, last_name, email, phone,
        service_type, vehicle_type, pickup_date, pickup_time,
        pickup_address, destination, passengers, miles, total_amount,
        payment_method, payment_status, status, assigned_driver_id, assigned_driver_name
      ) VALUES
      ($1, 'Alice', 'Williams', 'alice@example.com', '555-0200', 'Airport Transfer', 'Luxury Sedan', $2, '09:00:00', '123 Market St, San Francisco, CA', 'SFO Airport', 1, 14.5, 95.00, 'credit', 'paid', 'completed', $3, 'Sarah Jenkins'),
      ($4, 'Bob', 'Johnson', 'bob.j@example.com', '555-0201', 'Corporate Travel', 'Premium SUV', $5, '14:30:00', 'OAK Airport', '456 Tech Blvd, San Jose, CA', 3, 35.2, 150.00, 'credit', 'paid', 'confirmed', $6, 'John Smith'),
      ($7, 'Charlie', 'Davis', 'charlie@example.com', '555-0202', 'Wedding & Events', 'Sprinter Van', $8, '18:00:00', '789 Napa Valley Rd, Napa, CA', 'Hotel Downtown SFC', 8, 45.0, 450.00, 'credit', 'pending', 'pending', NULL, NULL),
      ($9, 'Diana', 'Prince', 'diana@example.com', '555-0203', 'Point-to-Point', 'Luxury Sedan', $10, '12:00:00', '101 Bay Blvd, Palo Alto, CA', 'Golden Gate Bridge', 2, 30.0, 120.00, 'cash', 'pending', 'confirmed', NULL, NULL),
      ($11, 'Evan', 'Wright', 'evan@example.com', '555-0204', 'Hourly As-Directed', 'Premium SUV', $12, '10:00:00', '202 Wine Country Tour', 'Same as pickup', 4, 0, 300.00, 'credit', 'paid', 'refund_requested', NULL, NULL)
      ON CONFLICT (booking_id) DO NOTHING;
    `;

        await pool.query(bookingQuery, [
            generateId('B-COMP-'), formatDate(today), d2,
            generateId('B-CONF-'), formatDate(tomorrow), d1,
            generateId('B-PEND-'), formatDate(nextWeek),
            generateId('B-CASH-'), formatDate(tomorrow),
            generateId('B-REF-'), formatDate(nextWeek)
        ]);
        console.log('✅ Demo bookings inserted');

    } catch (err) {
        console.error('❌ Data insertion error:', err);
    }
};

const runSeed = async () => {
    console.log('🌱 Starting DB Seed Process...');
    await createBookingsTable();
    await createDriversTable();
    await insertData();
    console.log('✅ DB Seeding Complete.');
    process.exit(0);
};

runSeed();
