const fetch = require('node-fetch');

const createBookings = async () => {
    // Helper to format date YYYY-MM-DD
    const formatDate = (date) => date.toISOString().split('T')[0];
    const timestamp = Date.now();

    // 1. BLOCKED Booking (Tomorrow - within 48h)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const blockedId = `test-blocked-${timestamp}`;

    // 2. ALLOWED Booking (5 days from now - outside 48h)
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 5);
    const allowedId = `test-allowed-${timestamp}`;

    const bookings = [
        {
            bookingId: blockedId,
            firstName: "Blocked",
            lastName: "User",
            email: "blocked@test.com",
            phone: "555-0101",
            serviceType: "transfer",
            vehicleType: "sedan",
            pickupDate: formatDate(tomorrow),
            pickupTime: "12:00",
            pickupAddress: "100 Short Notice St",
            destination: "Blocked Destination",
            totalAmount: 100,
            status: "confirmed",
            paymentMethod: "credit", // REQUIRED FIELD
            passengers: 2
        },
        {
            bookingId: allowedId,
            firstName: "Allowed",
            lastName: "User",
            email: "allowed@test.com",
            phone: "555-0102",
            serviceType: "transfer",
            vehicleType: "suv",
            pickupDate: formatDate(nextWeek),
            pickupTime: "12:00",
            pickupAddress: "500 Future Way",
            destination: "Allowed Destination",
            totalAmount: 200,
            status: "confirmed",
            paymentMethod: "credit", // REQUIRED FIELD
            passengers: 4
        }
    ];

    console.log(`\n--- Seeding Bookings ---`);
    for (const booking of bookings) {
        console.log(`🚀 Creating booking: ${booking.bookingId}...`);
        try {
            const response = await fetch('http://localhost:3001/api/bookings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(booking)
            });
            const result = await response.json();
            if (response.ok) {
                console.log(`✅ SUCCESS: Created ${booking.bookingId}`);
            } else {
                console.error(`❌ FAILED: ${booking.bookingId}`, result);
            }
        } catch (error) {
            console.error(`❌ NETWORK ERROR for ${booking.bookingId}:`, error);
        }
    }
    console.log(`\n--- Done ---`);
    console.log(`Blocked URL: http://localhost:5080/edit-ride/${blockedId}`);
    console.log(`Allowed URL: http://localhost:5080/edit-ride/${allowedId}`);
};

createBookings();
