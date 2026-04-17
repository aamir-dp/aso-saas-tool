/**
 * ASO SaaS - Frontend API Wrapper
 * ================================
 * 
 * This file handles all communication between frontend and Google Apps Script backend
 * Includes comprehensive error handling, retries, and performance optimization
 * 
 * SETUP:
 * 1. Deploy GAS-Backend.gs as a Web App
 * 2. Copy the URL here
 * 3. Use these functions in your HTML files
 */

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * YOUR GAS WEB APP URL
 * Replace this with your deployed Google Apps Script URL
 * Format: https://script.google.com/macros/s/{PROJECT_ID}/exec
 */
const API_URL = "https://script.google.com/macros/s/AKfycbyi4--RJyMjR47j_zZlpjwOPtflhe8IOno7BbFNZ52fqlTG9a3tzDS8j70M6coAXVZO/exec";

// API configuration
const API_TIMEOUT = 30000;
const API_MAX_RETRIES = 2;
const API_RETRY_DELAY = 1000; // milliseconds
const API_CACHE_DURATION = 60000; // 1 minute

// Cache for API responses
const apiCache = new Map();
const requestQueue = new Map();
let isConfigured = false;

// ============================================================
// CORE API FUNCTIONS
// ============================================================

/**
 * Initialize API configuration
 */
function initializeAPI() {
    const isValid = API_URL && !API_URL.includes("YOUR_GAS_PROJECT_ID");
    if (!isValid) {
        console.warn("⚠️  API_URL not configured. Update js/api.js with your GAS URL.");
    }
    isConfigured = isValid;
    return isValid;
}

/**
 * Main function to call the API with error handling, retries, and caching
 * 
 * @param {object} data - Request data object
 * @param {object} options - Optional configuration {cache: true, retry: 2}
 * @returns {Promise<object>} Response from API
 * @throws {Error} If API call fails after retries
 */
async function callAPI(data, options = {}) {
    const { cache = true, retry = API_MAX_RETRIES } = options;

    // Validate configuration
    if (!isConfigured) {
        initializeAPI();
        if (!isConfigured) {
            throw new Error("❌ API_URL not configured. Please update js/api.js with your GAS URL.");
        }
    }

    // Validate request data
    if (!data || typeof data !== 'object') {
        throw new Error("❌ Invalid request data. Must be an object.");
    }

    if (!data.type) {
        throw new Error("❌ Request type is required (type property).");
    }

    // Check cache for GET-like operations
    const cacheKey = `${data.type}:${JSON.stringify(data)}`;
    if (cache && apiCache.has(cacheKey)) {
        const { result, timestamp } = apiCache.get(cacheKey);
        if (Date.now() - timestamp < API_CACHE_DURATION) {
            return result;
        }
        apiCache.delete(cacheKey);
    }

    // Implement retry logic
    let lastError;
    for (let attempt = 0; attempt <= retry; attempt++) {
        try {
            const result = await executeAPICall(data);

            // Cache successful result
            if (cache) {
                apiCache.set(cacheKey, { result, timestamp: Date.now() });
            }

            return result;

        } catch (error) {
            lastError = error;

            // Don't retry on client errors (4xx) or validation errors
            if (error.isClientError) {
                throw error;
            }

            // Retry on network or server errors
            if (attempt < retry) {
                const delay = API_RETRY_DELAY * (attempt + 1);
                console.log(`⏳ Retrying in ${delay}ms... (attempt ${attempt + 1}/${retry})`);
                await sleep(delay);
            }
        }
    }

    // All retries failed
    throw new Error(`❌ API call failed after ${retry + 1} attempts: ${lastError.message}`);
}

/**
 * Execute single API call with timeout
 */
async function executeAPICall(data) {
    return new Promise(async (resolve, reject) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

        try {
            const response = await fetch(API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Request-ID": generateRequestId(),
                },
                body: JSON.stringify(data),
                signal: controller.signal,
                credentials: 'omit'
            });

            clearTimeout(timeoutId);

            // Handle HTTP errors
            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
                error.isClientError = response.status >= 400 && response.status < 500;
                error.statusCode = response.status;
                throw error;
            }

            // Parse response
            let result;
            try {
                result = await response.json();
            } catch (e) {
                throw new Error("Invalid JSON response from API. Check GAS deployment.");
            }

            // Check for API-level errors
            if (result.error) {
                const error = new Error(result.error);
                error.isClientError = true;
                throw error;
            }

            resolve(result);

        } catch (error) {
            clearTimeout(timeoutId);

            // Handle abort/timeout
            if (error.name === "AbortError") {
                reject(new Error(`Request timeout after ${API_TIMEOUT}ms`));
                return;
            }

            // Handle network errors
            if (error instanceof TypeError) {
                reject(new Error("Network error: Cannot reach API. Check connection and CORS."));
                return;
            }

            reject(error);
        }
    });
}

/**
 * Generate unique request ID for tracking
 */
function generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Sleep utility for delays
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// KEYWORD RESEARCH API CALLS - SUPPORTS ANY COUNTRY/LANGUAGE
// ============================================================

/**
 * Evaluate a single keyword with validation
 * Supports any country/language combination from Apple App Store
 * 
 * @param {string} keyword - Keyword to evaluate
 * @param {string} appId - Optional app ID
 * @param {string} country - Country code (e.g., 'US', 'DE', 'JP', 'CN')
 * @returns {Promise<object>} Keyword score result
 */
async function evaluateKeyword(keyword, appId, country) {
    // Validate inputs
    if (!keyword || typeof keyword !== 'string') {
        throw new Error("Keyword must be a non-empty string.");
    }

    keyword = keyword.trim();
    if (keyword.length < 1 || keyword.length > 100) {
        throw new Error("Keyword must be between 1 and 100 characters.");
    }

    if (!country || typeof country !== 'string') {
        throw new Error("Country code is required (e.g., 'US', 'DE', 'JP').");
    }

    country = country.toUpperCase();

    // Sanitize app ID if provided
    if (appId && typeof appId === 'string') {
        appId = appId.trim();
        if (appId && isNaN(appId)) {
            throw new Error("App ID must be numeric.");
        }
    }

    return callAPI({
        type: "keyword",
        keyword: keyword,
        appId: appId || "",
        country: country
    }, { cache: false, retry: 2 });
}

/**
 * Evaluate multiple keywords (batch) with validation
 * Supports any country/language combination
 * 
 * @param {Array<string>} keywords - Array of keywords (max 20)
 * @param {string} appId - Optional app ID
 * @param {string} country - Country code (e.g., 'US', 'DE', 'JP')
 * @returns {Promise<object>} Batch results with sheet URL
 */
async function evaluateBatchKeywords(keywords, appId, country) {
    // Validate inputs
    if (!Array.isArray(keywords)) {
        throw new Error("Keywords must be an array.");
    }

    if (keywords.length === 0) {
        throw new Error("Please provide at least one keyword.");
    }

    if (keywords.length > 20) {
        throw new Error(`Maximum 20 keywords allowed. You provided ${keywords.length}.`);
    }

    // Clean and validate keywords
    const cleanedKeywords = keywords
        .map(kw => typeof kw === 'string' ? kw.trim() : String(kw).trim())
        .filter(kw => kw.length > 0);

    if (cleanedKeywords.length === 0) {
        throw new Error("No valid keywords after cleanup. Please enter keywords.");
    }

    // Check for duplicates
    const uniqueKeywords = [...new Set(cleanedKeywords)];
    if (uniqueKeywords.length < cleanedKeywords.length) {
        console.warn("⚠️  Removed duplicate keywords.");
    }

    if (!country || typeof country !== 'string') {
        throw new Error("Country code is required (e.g., 'US', 'DE', 'JP').");
    }

    country = country.toUpperCase();

    return callAPI({
        type: "batch",
        keywords: uniqueKeywords,
        appId: appId || "",
        country: country
    }, { cache: false, retry: 1 });
}

// ============================================================
// ASO GENERATION & ANALYSIS API CALLS
// ============================================================

/**
 * Generate ASO content (Title, Subtitle, Keywords) with validation
 * 
 * @param {object} options - Generation options
 * @returns {Promise<object>} Generated content
 */
async function generateASOContent(options) {
    if (!options || typeof options !== 'object') {
        throw new Error("Generation options are required.");
    }

    return callAPI({
        type: "aso",
        ...options
    }, { cache: false, retry: 1 });
}

/**
 * Analyze app metadata with validation
 * 
 * @param {object} options - Analysis options
 * @returns {Promise<object>} Analysis results
 */
async function analyzeMetadata(options) {
    if (!options || typeof options !== 'object') {
        throw new Error("Analysis options are required.");
    }

    return callAPI({
        type: "analysis",
        ...options
    }, { cache: false, retry: 1 });
}

// ============================================================
// HEALTH CHECK
// ============================================================

/**
 * Check if backend is online with proper error handling
 * 
 * @returns {Promise<boolean>} True if API is responding
 */
async function checkAPIHealth() {
    try {
        const result = await callAPI({ type: "ping" }, { cache: true, retry: 1 });
        return result && result.status === "ok";
    } catch (error) {
        console.error("Health check failed:", error.message);
        return false;
    }
}

/**
 * Run health check on page load
 */
document.addEventListener('DOMContentLoaded', () => {
    initializeAPI();
    checkAPIHealth().then(isHealthy => {
        if (!isHealthy && isConfigured) {
            console.warn("⚠️  Backend API is not responding. Some features may not work.");
        }
    });
});

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Format score for display with validation
 */
function formatScore(score) {
    try {
        const num = parseFloat(score);
        return isNaN(num) ? "N/A" : num.toFixed(1);
    } catch (e) {
        return "N/A";
    }
}

/**
 * Get score color class based on value
 */
function getScoreClass(score) {
    try {
        const num = parseFloat(score);
        if (isNaN(num)) return 'score-low';
        if (num >= 7) return 'score-high';
        if (num >= 4) return 'score-med';
        return 'score-low';
    } catch (e) {
        return 'score-low';
    }
}

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    if (typeof text !== 'string') text = String(text);

    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Format date for display with error handling
 */
function formatDate(date) {
    try {
        const d = new Date(date);
        if (isNaN(d.getTime())) return 'Invalid date';
        return d.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return 'Invalid date';
    }
}

/**
 * Debounce function to prevent rapid API calls
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function for rate limiting
 */
function throttle(func, limit) {
    let inThrottle;
    return function (...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// ============================================================
// ERROR HANDLING & USER FEEDBACK
// ============================================================

/**
 * Show user-friendly error message with better styling
 */
function showError(message, container = null) {
    const errorMsg = escapeHtml(message || "An unknown error occurred");

    if (container) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.setAttribute('role', 'alert');
        errorDiv.innerHTML = `❌ ${errorMsg}`;
        errorDiv.style.animation = 'slideInDown 0.3s ease-out';

        container.insertBefore(errorDiv, container.firstChild);

        // Auto-remove after 10 seconds
        setTimeout(() => errorDiv.remove(), 10000);
    } else {
        alert('Error: ' + errorMsg);
    }

    console.error('Error:', errorMsg);
}

/**
 * Show success message with confirmation
 */
function showSuccess(message, container = null) {
    const successMsg = escapeHtml(message || "Operation completed successfully");

    if (container) {
        const successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        successDiv.setAttribute('role', 'status');
        successDiv.innerHTML = `✅ ${successMsg}`;
        successDiv.style.animation = 'slideInDown 0.3s ease-out';

        container.insertBefore(successDiv, container.firstChild);

        // Auto-remove after 8 seconds
        setTimeout(() => successDiv.remove(), 8000);
    } else {
        console.log('Success:', successMsg);
    }
}

/**
 * Show warning message
 */
function showWarning(message, container = null) {
    const warningMsg = escapeHtml(message || "Warning");

    if (container) {
        const warningDiv = document.createElement('div');
        warningDiv.className = 'warning-message';
        warningDiv.setAttribute('role', 'alert');
        warningDiv.innerHTML = `⚠️  ${warningMsg}`;
        warningDiv.style.animation = 'slideInDown 0.3s ease-out';

        container.insertBefore(warningDiv, container.firstChild);

        // Auto-remove after 10 seconds
        setTimeout(() => warningDiv.remove(), 10000);
    }

    console.warn('Warning:', warningMsg);
}

// ============================================================
// INITIALIZATION
// ============================================================

/**
 * Initialize API on page load
 */
window.addEventListener('load', async () => {
    // Check if API is configured
    if (API_URL.includes("YOUR_GAS_PROJECT_ID")) {
        console.warn("⚠️ API_URL not configured. Update js/api.js with your GAS URL");
    }

    // Optional: Check API health
    const isHealthy = await checkAPIHealth();
    if (!isHealthy) {
        console.warn("⚠️ Backend API may be offline");
    }

    console.log("✅ API wrapper initialized");
});

// ============================================================
// EXPORT FOR USE
// ============================================================

// If using modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        callAPI,
        evaluateKeyword,
        evaluateBatchKeywords,
        generateASOContent,
        analyzeMetadata,
        checkAPIHealth,
        formatScore,
        getScoreClass,
        escapeHtml,
        formatDate,
        showError,
        showSuccess
    };
}
