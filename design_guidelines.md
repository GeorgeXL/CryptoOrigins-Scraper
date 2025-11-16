# Bitcoin News Analysis System - Design Guidelines

## Design Approach

**Reference-Based Hybrid**: Drawing from Bloomberg Terminal's information density, CoinMarketCap's data visualization, and Linear's refined dark UI aesthetics. The design balances analytical rigor with crypto-native visual language while maintaining exceptional usability for fact-checking workflows.

## Typography System

**Font Stack**: 
- Primary: Inter (headings, UI elements) - via Google Fonts
- Secondary: JetBrains Mono (data, timestamps, technical indicators)

**Hierarchy**:
- Hero Headline: text-5xl lg:text-7xl, font-bold, tracking-tight
- Section Headers: text-3xl lg:text-4xl, font-semibold
- Article Titles: text-xl lg:text-2xl, font-semibold
- Body Text: text-base lg:text-lg, leading-relaxed
- Data Labels: text-sm, font-medium, uppercase, tracking-wide
- Timestamps/Meta: text-xs lg:text-sm, JetBrains Mono

## Layout System

**Spacing Primitives**: Tailwind units of 4, 6, 8, 12, 16, 24
- Component padding: p-6 to p-8
- Section spacing: py-16 lg:py-24
- Card gaps: gap-6 lg:gap-8
- Inline elements: space-x-4

**Grid Structure**:
- Container: max-w-7xl mx-auto px-6 lg:px-8
- News Grid: grid-cols-1 md:grid-cols-2 lg:grid-cols-3
- Dashboard: Two-column split (scan controls + results) on desktop, stacked mobile

## Core Components

### Navigation
Fixed header with blur backdrop, height h-16
- Logo left (Bitcoin icon + wordmark)
- Center: News, Analysis, Fact-Check, Database tabs
- Right: Search icon, Settings icon, Live status indicator (pulsing dot)

### Hero Section
Full-width with dynamic Bitcoin chart visualization image background (80vh)
- Overlay gradient for readability
- Centered content: max-w-4xl
- Headline + subheadline stack
- Dual CTA buttons (primary: "Start Fact-Checking", secondary: "Browse Analysis") with backdrop-blur-md bg-opacity treatment
- Live stats ticker below CTAs: 3-column grid showing Active Sources, Articles Analyzed Today, Verification Rate

### News Analysis Grid
3-column masonry-style layout
Each card includes:
- Thumbnail image (aspect-ratio-16/9)
- Source badge (top-left overlay with blur background)
- Verification status icon (checkmark/warning/pending)
- Headline + excerpt
- Metadata row: timestamp, read time, credibility score
- Hover: subtle lift transform and border glow effect

### Fact-Checking Dashboard
**Scan Control Panel** (left column, sticky):
- Large database scan button (prominent, with scanning animation state)
- Source filter checkboxes (major news outlets)
- Timeframe selector (24h, 7d, 30d, All)
- Advanced options accordion: keyword filters, credibility threshold slider
- Scan history list (recent scans with timestamps)

**Results Section** (right column, 2/3 width):
- Status banner: scan progress or completion state
- Results summary cards: Total Claims Analyzed, Verified, Disputed, Unverified (4-column grid)
- Detailed results table with expandable rows:
  - Claim text
  - Source
  - Verification status badge
  - Confidence percentage
  - Supporting/Contradicting sources count
  - Expand button reveals evidence breakdown
- Infinite scroll for large result sets

### Data Visualization Components
- Line charts: Bitcoin price correlation with news sentiment
- Bar graphs: Source reliability rankings
- Pie charts: Claim category distribution
- Heat map: Topic trending timeline

### Article Detail View
- Full-width header with source verification badge
- Two-column layout: article content (60%) + fact-check sidebar (40%)
- Inline claim highlighting with verification tooltips
- Related articles carousel at bottom

## Component Library

**Buttons**:
- Primary: Rounded-lg, px-6 py-3, font-semibold, with accent color
- Secondary: Outlined variant with hover fill
- Icon buttons: rounded-full p-2
- Scan button: Extra large px-12 py-6 with icon and loading spinner state

**Cards**:
- Rounded-xl, backdrop-blur with subtle border
- Padding: p-6
- Hover states with scale transform

**Badges**:
- Rounded-full px-3 py-1 text-xs font-medium
- Status variants: verified (green), disputed (red), pending (amber), unverified (gray)

**Form Inputs**:
- Rounded-lg border with focus ring
- Height h-12, padding px-4
- Search: with leading icon, rounded-full variant

**Tables**:
- Striped rows for readability
- Fixed header on scroll
- Expandable rows with smooth height transition

## Images Section

**Hero Background**: 
Abstract, futuristic Bitcoin/blockchain visualization - glowing network nodes, data streams, or dynamic price chart visualization. Dark atmospheric treatment with orange/amber highlights. Image should convey technological sophistication and real-time data analysis. Position: Full-width background, 80vh height.

**News Card Thumbnails**:
Varied imagery - Bitcoin/crypto related graphics, news event photos, data visualization screenshots, analyst headshots. Aspect ratio 16:9. Position: Top of each news card with rounded-t-xl corners.

**Dashboard Placeholder States**:
Illustrative empty state graphics when no scan results (abstract magnifying glass over data network). Center-aligned in results area.

## Interaction Patterns

- Smooth scroll behavior for anchor navigation
- Skeleton loading states for async content
- Toast notifications for scan completion
- Modal overlays for detailed evidence review
- Sticky navigation and dashboard controls
- Infinite scroll with loading indicators

## Responsive Behavior

- Mobile: Single column, collapsible filters drawer, bottom navigation tabs
- Tablet: 2-column grids, side drawer for dashboard controls
- Desktop: Full multi-column layouts, fixed sidebars