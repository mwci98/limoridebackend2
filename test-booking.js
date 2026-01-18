const fetch = require('node-fetch');

const createBooking = async () => {
    const bookingData = {
        bookingId: `TEST-${Date.now()}`,
        firstName: "Test",
        lastName: "User",
        email: "test@example.com", // This must match the user's login email if possible, but I'll ask user to login as this
        phone: "1234567890",
        serviceType: "pointToPoint",
        vehicleType: "sedan",
        pickupDate: "2026-02-01",
        pickupTime: "10:00",
        pickupAddress: "123 Test St, Silicon Valley, CA",
        destination: "456 Mock Rd, San Francisco, CA",
        passengers: 2,
        miles: 15.5,
        hours: 0,
        totalAmount: 150.00,
        paymentMethod: "credit",
        paymentStatus: "paid",
        specialRequests: "Debug test booking"
    };

    console.log('🚀 Sending Test Booking...');
    try {
        const response = await fetch('http://localhost:3001/api/bookings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bookingData)
        });

        const result = await response.json();
        console.log('✅ Server Response:', result);
        console.log('\n👉 NOTE: Login to Customer Dashboard with email: test@example.com to see this booking.');
    } catch (error) {
        console.error('❌ Error:', error);
    }
};

createBooking();
