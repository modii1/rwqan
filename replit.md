# نظام إدارة العقارات - روقـان 🏡

## Overview
روقـان (RWQAN) is a comprehensive property management system designed for investment properties in the Qassim region of Saudi Arabia. It offers a premium platform for showcasing properties, integrated with a sophisticated subscription model, secure payment gateways, and cloud storage solutions. The project aims to streamline property listings, enhance user experience with advanced filtering, and provide robust management tools for property owners and administrators.

## User Preferences
- **Coding Style**: The user prefers clean, modular, and well-documented code, with an emphasis on maintainability and scalability.
- **Communication**: The user prefers clear and concise communication, focusing on solutions and potential issues with proposed changes.
- **Workflow**: The user favors an iterative development approach, with regular updates and opportunities for feedback.
- **Interaction**: The user expects the agent to ask for confirmation before implementing significant architectural changes or refactoring large portions of the codebase.
- **Language**: All generated content and explanations should be in Arabic.

## Recent Changes (December 08, 2025)
- **Smart Property Verification System**: Redesigned verification process to check property data completeness using existing Google Sheets columns:
  - **Images**: Fetched from Replit Object Storage (R2) via `/api/owner/r2-images` (requires ≥3 images)
  - **Facilities**: Read from column 8 (`🔹 المرافق`) - supports both JSON array and comma-separated formats (requires ≥3)
  - **Location/Region**: Read from columns 4 (`📍 الموقع`) and 5 (`📍 المنطقة`)
  - **Prices**: Read from columns 10-15 (weekday, weekend, overnight, special, holidays)
  - **Type**: Read from column 7 (`🏠 النوع`)
- **Auto-Activation**: Upon successful property verification, system automatically updates `verificationStatus` to "approved" and activates subscription if valid payment exists.
- **No New Columns Added**: Verification uses only existing Google Sheets columns - no `imageUrls`, `amenities`, or `region` columns needed.
- **Payment Button Logic**: Refined button display - "رفع إيصال" for bank transfer receipts, "إكمال الدفع" only for Paymob electronic payments with paymobOrderId.
- **Package Names**: Fixed Arabic display of package names in payment history (e.g., "اشتراك خاص شهرين" for pkg-special-2months).
- **Date Format**: Changed from Arabic Hijri to English Gregorian format using `toLocaleDateString('en-US')` for better consistency.
- **Error Handling**: Red display with specific error messages and "تعديل البيانات" option when validation fails; green success with auto-activation when all checks pass.
- **API Endpoint**: Added `/api/owner/property/activate` for automatic subscription activation after property data verification.

## System Architecture

### UI/UX Decisions
- **Design Language**: Luxurious Arabic RTL design with a golden color scheme (#b88d2b).
- **Fonts**: Cairo from Google Fonts.
- **Responsive Design**: Mobile-first approach, 100% responsive.
- **Property Cards**: Differentiated styling for "Trusted" (paid) properties (background #fffdf0, border #e0c97b) and free listings.
- **Navigation**: Collapsible and movable sidebar for easy navigation, automatically hidden/shown on small screens.
- **WhatsApp Button**: Green (#25D366) with request logging.

### Technical Implementations
- **Frontend**: React, Vite, TypeScript, Tailwind CSS, shadcn/ui.
- **Backend**: Express.js, TypeScript.
- **Data Storage**: Google Sheets for all primary data (properties, subscriptions, payments, etc.).
- **Image Storage**: Replit Object Storage (R2) for property images, organized by property number.
- **Receipt Storage**: Replit Object Storage for payment receipts.
- **Payment Gateway**: Paymob for secure credit card and Apple Pay transactions, including webhook for automatic updates.
- **Analytics**: Google Analytics 4.
- **Messaging**: Meta WhatsApp Business API for instant notifications to the administrator.
- **Smart Verification**: Automated bank transfer verification system for subscription activation.
- **Fee Management**: Customizable Paymob KSA fee configuration via an admin panel.
- **Date & Time Management**: All dates and times are handled in Riyadh local time (UTC+3) using Gregorian calendar, with dedicated utility functions.
- **Scheduler**: Daily automated tasks for subscription expiry checks and status updates.

### Feature Specifications
- **Property System**:
    - Luxurious property display with distinct cards.
    - Smart sorting: Trusted (paid) properties prioritized at the top.
    - 100 amenity filters, smart filters (city, direction, type, price), and comprehensive search.
    - Interactive image gallery (up to 15 images per property).
    - Multiple pricing options (mid-week, weekend, overnight, holidays).
- **Subscription System**:
    - Two types: "Trusted" (paid, premium display, priority) and "Normal" (free, basic display, lower priority).
    - Five package options, including monthly, promotional, multi-property, and free.
    - Discount codes (percentage or fixed amount).
    - Automatic renewal with daily scheduling.
- **WhatsApp Notification System**: Real-time notifications to admin for new properties, property edits, WhatsApp inquiries, receipt uploads, property approval/rejection, and manual messages.
- **Secure Payment Flow**: Payment initiated, pending record created, Paymob webhook confirms payment, then subscription activated. HMAC validation for webhooks.
- **User Authentication**: Secure login for owners (property ID + PIN).

### Data Structure (Google Sheets)
- **Property Data**: Property number (required, 5 digits), name, PIN, city, direction, type, amenities (comma-separated or JSON array), prices, subscription type, Drive folder ID.
- **Subscriptions**: Start/end date, status, package ID, payment ID.
- **Packages**: Name, duration, price, type, features, activation status.
- **Discount Codes**: Code, type (percentage/fixed), value, expiry date, activation status.
- **Payments**: Amount, discount code, final amount, Paymob ID, status, payment method, receipt link, and metadata (`action`, `pendingStartDate`, `pendingEndDate`, `pendingSubscriptionType`, `pendingPrice`) for payment verification.
- **Requests (WhatsApp)**: Auto-generated short code, property number, request time.
- **Suggestions**: Name, mobile, city, suggestion, status.
- **Fee Settings**: Configuration for different payment methods (Mada, STC Pay, Visa/MC, Apple Pay) including percentages, fixed fees, and tax rates.

## External Dependencies

-   **Google Sheets**: Primary database for all application data.
    -   `GOOGLE_SHEET_ID`
    -   `GOOGLE_SERVICE_ACCOUNT_KEY` (JSON key)
-   **Google Drive**: Stores property images.
    -   Service Account: `moddy-drive-service@modi-bot-465120.iam.gserviceaccount.com` (Editor access to main folder `169jrXmGGQ27mtjkubu-i762xwQQ3e1uE`)
-   **Paymob**: Payment gateway for transactions.
    -   `PAYMOB_API_KEY`
    -   `PAYMOB_PUBLIC_KEY`
    -   `PAYMOB_HMAC_SECRET`
    -   `PAYMOB_INTEGRATION_ID_CARDS`
    -   `PAYMOB_INTEGRATION_ID_APPLEPAY`
-   **Replit Object Storage**: Stores payment receipts.
    -   `DEFAULT_OBJECT_STORAGE_BUCKET_ID`
-   **Google Analytics 4**: For tracking website visitors and statistics.
-   **Meta WhatsApp Business API**: For sending automated WhatsApp notifications.
    -   `META_WHATSAPP_TOKEN`
    -   `META_PHONE_NUMBER_ID`
    -   `META_NOTIFY_NUMBER`