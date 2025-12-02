// Define the gtag function globally
declare global {
  interface Window {
    dataLayer: any[];
    gtag: (...args: any[]) => void;
  }
}

// Initialize Google Analytics
export const initGA = () => {
  const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID;
  
  console.log('📊 Google Analytics Init:', { measurementId, env: import.meta.env.MODE });

  if (!measurementId) {
    console.warn('Missing required Google Analytics key: VITE_GA_MEASUREMENT_ID');
    return;
  }

  // Initialize dataLayer
  if (!window.dataLayer) {
    window.dataLayer = [];
  }

  // Define gtag function
  window.gtag = function() {
    window.dataLayer.push(arguments);
  };

  // Set default consent mode
  window.gtag('consent', 'default', {
    'analytics_storage': 'denied'
  });

  // Load Google Analytics script
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  
  script.onload = () => {
    console.log('✅ Google Analytics script loaded successfully');
    // Initialize gtag config after script loads
    window.gtag('js', new Date());
    window.gtag('config', measurementId, {
      'allow_google_signals': false,
      'anonymize_ip': true,
      'send_page_view': true
    });
    console.log('✅ Google Analytics configured:', measurementId);
  };

  script.onerror = () => {
    console.error('❌ Failed to load Google Analytics script');
  };

  document.head.appendChild(script);
};

// Track page views - useful for single-page applications
export const trackPageView = (url: string) => {
  if (typeof window === 'undefined' || !window.gtag) {
    console.warn('⚠️ gtag not available for page view tracking');
    return;
  }
  
  const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID;
  if (!measurementId) return;
  
  console.log('📄 Tracking page view:', url);
  window.gtag('config', measurementId, {
    page_path: url,
    page_title: document.title
  });
};

// Track events
export const trackEvent = (
  action: string, 
  category?: string, 
  label?: string, 
  value?: number
) => {
  if (typeof window === 'undefined' || !window.gtag) {
    console.warn('⚠️ gtag not available for event tracking');
    return;
  }
  
  console.log('📊 Tracking event:', { action, category, label, value });
  window.gtag('event', action, {
    event_category: category,
    event_label: label,
    value: value,
  });
};
