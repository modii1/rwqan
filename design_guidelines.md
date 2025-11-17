# Design Guidelines - نظام إدارة العقارات (Property Management System)

## Design Approach
**Reference-Based + Custom Luxury System**: Inspired by premium Arabic real estate platforms with a unique golden-luxury aesthetic. The design combines Airbnb's card-based layout with a custom Arabic luxury treatment using warm golden tones and sophisticated typography.

## Core Design Principles
1. **Arabic-First RTL Design**: All layouts flow right-to-left with Arabic typography hierarchy
2. **Luxury & Trust**: Premium golden palette communicates quality and reliability
3. **Mobile-First Responsive**: Optimized for Saudi mobile users (primary access method)
4. **Visual Hierarchy**: Premium "موثوق" properties always displayed first with distinctive styling

---

## Typography
**Font Family**: Cairo (Google Fonts) - optimized for Arabic readability
- **Primary Headers (H1)**: 700 weight, 22-28px, #4a3b2a
- **Section Titles (H2/H3)**: 700 weight, 18-20px, #b88d2b (golden)
- **Card Titles**: 700 weight, 18px, #4a3b2a
- **Body Text**: 400 weight, 14-15px, #5b4a1f
- **Labels/Metadata**: 500 weight, 13-14px, #444

---

## Color System
**Primary Palette**:
- **Golden Primary**: #b88d2b (buttons, headers, accents)
- **Golden Light**: #d4a035, #e0c97b (gradients, borders)
- **Warm Background**: #fafaf5 (main), #fcfbf5 (cards), #fffdf0 (premium cards)
- **Dark Text**: #4a3b2a (primary), #5b4a1f (secondary)

**Accent Colors**:
- **Trusted Badge**: #fff8d6 background, #b38b00 text
- **Success**: #2e9e36 (active status), #25D366 (WhatsApp)
- **Error**: #c62828
- **Overlays**: rgba(0,0,0,0.85) for modals

---

## Layout System
**Spacing Units**: Use Tailwind's 2, 4, 6, 8, 10, 12, 15, 20, 25, 30 units
- **Card Padding**: 15-25px
- **Section Spacing**: 20-30px vertical gaps
- **Grid Gaps**: 10-20px between cards
- **Filter Spacing**: 15-20px between filter boxes

**Responsive Grid**:
- **Desktop**: `grid-template-columns: repeat(auto-fill, minmax(330px, 1fr))`
- **Mobile**: Single column, full-width cards with min 280px

---

## Component Library

### 1. Property Cards
**Standard Card**:
- Background: #fcfbf5
- Border-radius: 10px
- Shadow: `0 0 6px rgba(192,178,153,0.3)`
- Padding: 15px
- Min-height: 400px (with 78px footer space)

**Premium "موثوق" Card**:
- Background: #fffdf0 (golden cream)
- Border: 2px solid #e0c97b
- Shadow: `0 0 8px rgba(224,201,123,0.35)`
- Badge: Small rounded pill "موثوق" (#fff8d6 bg, #b38b00 text, 700 weight)
- **Always appears first** in listings

**Card Elements**:
- **Property Number**: 5-digit format (e.g., 00123), positioned top-left, 14px bold
- **Image Carousel**: 200px height, 100% width, horizontal scroll, gap: 10px, border-radius: 12px
- **Title**: 18px bold, #4a3b2a
- **Price Box**: 
  - Background: #fff8e5
  - Border: 1px solid #f0c419
  - Padding: 8-10px
  - Multiple rows: "وسط الأسبوع", "نهاية الأسبوع", "مبيت", etc.
  - Price color: #008000 (green), 15px bold
- **Footer Buttons** (absolute bottom):
  - "فتح ملف العقار": #4a3b1a background, white text
  - "تواصل عبر واتساب": #25D366 background, white text
  - Padding: 10px 8px, border-radius: 6px, gap: 8px

### 2. Filters Container
- Background: #f9f8f0
- Padding: 15px
- Border-radius: 10px
- Shadow: `0 0 6px rgba(192,178,153,0.3)`
- Flex-wrap with 20px gap
- Filter boxes: Min-width 140px, labels bold, dropdowns with 1px #ccc border

**Category Buttons** (Pool, Events, etc.):
- Background: #fcfbf5
- Border-radius: 8px
- Padding: 10px 12px
- Hover/Active: #dcd6b8 background
- Font: 700 weight, center-aligned

**Search Input**:
- Placeholder: "بحث شامل"
- Icon: 🔍
- Full-width in filter box

**Price Slider**:
- Dual-range sliders (min/max)
- Range: 0-5000 SAR, step: 50
- Labels show current values

### 3. Subscription Package Cards
**Luxury Gradient Design**:
- Background: rgba(255,255,255,0.9) with subtle backdrop-filter
- Border-radius: 25px
- Padding: 20px
- Border: 2px solid transparent → #d4a035 on hover
- Shadow: `0 10px 25px rgba(0,0,0,0.12)` → `0 15px 35px rgba(0,0,0,0.2)` on hover
- Transform: `translateY(-5px) scale(1.05)` on hover

**Selected State**:
- Border: 2px solid #b88d2b
- Background: rgba(255,240,194,0.9)
- Shadow: `0 14px 40px rgba(0,0,0,0.18)`

**Card Content**:
- Title: 18px bold, #b88d2b
- Duration: "المدة: X يوم"
- Price: "الرسوم: X ريال"
- Icon: 24px, color: #b88d2b, scale(1.3) rotate(10deg) on hover

### 4. Buttons
**Primary Action**:
- Background: `linear-gradient(135deg, #b88d2b, #d4a035)`
- Hover: `linear-gradient(135deg, #a27b20, #c49325)` + `translateY(-2px)`
- Padding: 14px 20px
- Border-radius: 12px
- Font: 700 weight, 16px
- Full-width for forms

**Secondary Actions**:
- Solid backgrounds (#5a5a5a for refresh, etc.)
- Same padding/radius as primary

**Buttons on Images** (Hero/Cards):
- Semi-transparent background with blur: `rgba(255,255,255,0.25)` + `backdrop-filter: blur(10px)`
- No hover background color change (only transform/shadow)

### 5. Header
**Sticky Header**:
- Background: #fff
- Position: sticky, top: 0, z-index: 10
- Padding: 10-20px
- Shadow: `0 2px 4px rgba(0,0,0,0.05)`
- Flex layout: Logo (90px height, border-radius: 8px) + Title (22px bold, #4a3b2a)
- Title text: "🏡 مودي الذكي - [Page Title]"

### 6. Image Modal
- Full-screen overlay: rgba(0,0,0,0.85)
- Close button: Top-right, 35px, white, bold
- Navigation arrows: Fixed left/right, 55px circular, rgba(0,0,0,0.4) background
- Image: Max 90vw/80vh, border-radius: 8px
- Active image display: block, others: none

### 7. Forms
**Input Fields**:
- Padding: 10-12px
- Border: 1px solid #ccc → #b88d2b on focus
- Border-radius: 8-12px
- Font: Cairo, 15px
- Focus shadow: `0 0 10px rgba(184,141,43,0.3)`

**Labels**: 
- Font-weight: 500-700
- Margin-top: 15px
- Color: #444

**Facility Checkboxes**:
- 2-column layout in scrollable container (max-height: 220px)
- Background: #fafafa
- Border: 1px solid #ccc
- Border-radius: 8px
- Padding: 10px

### 8. Status Messages
- **Success**: Green text, center-aligned, 15px bold
- **Error**: Red (#c62828), center-aligned
- **Loading**: #b88d2b background, padding: 10-20px, border-radius: 8px

### 9. Dashboard/Admin Pages
**Section Titles**:
- Center-aligned, 20px bold, #b88d2b
- Underline accent: 60px wide, 3px height, #d4a035, centered below title

**Info Cards**:
- Background: rgba(255,255,255,0.85) with backdrop-filter
- Padding: 18-20px
- Border-radius: 15-20px
- Border: 1px dashed #d8b65a (for payment preview)
- Subtle inset shadow

---

## Animations
**Minimal & Purposeful**:
- **Hover Transforms**: `translateY(-2px)` to `translateY(-5px)` for cards/buttons
- **Transitions**: 0.3s ease for backgrounds, 0.4s ease for card hover
- **Icon Hover**: `scale(1.3) rotate(10deg)` for package card icons
- **No**: Excessive scroll animations, parallax, or loading spinners beyond necessity

---

## Images
**Hero Section**: 
- Not required for property listing page (header logo + filters suffice)
- For landing pages: Use warm, inviting property photos (1920x800px)

**Property Images**:
- Carousel: 10 images max per property
- Size: 800x600px recommended
- Border-radius: 12px
- Modal view: Full resolution with prev/next navigation

**Icons**:
- Use Font Awesome or Heroicons via CDN
- Size: 20-24px for inline, 32-45px for modal controls
- Color: Matches golden theme (#b88d2b)

---

## Accessibility
- RTL support throughout (direction: rtl)
- Input modes: `inputmode="numeric"` for phone/property numbers
- Labels: Always associated with inputs
- Focus states: Clear golden border + shadow
- Contrast: WCAG AA compliant (dark text on light backgrounds)
- Sticky header maintains context while scrolling

---

## Mobile Optimization
- Touch-friendly buttons (min 44px tap area)
- Single-column layouts on mobile
- Reduced padding/margins (20px → 15px)
- Filter boxes stack vertically
- Footer buttons full-width or stacked on <420px
- Carousel optimized for swipe gestures
- Font sizes scale down (22px → 18px for headers)