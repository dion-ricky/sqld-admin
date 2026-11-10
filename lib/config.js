"use strict";

/**
 * Environment configuration with validation and fail-fast on startup.
 */

// Get fresh environment variables each time
function getEnv() {
  return process.env;
}

// Configuration object - will be exported with named exports
const config = {
  // Server configuration
  get PORT() {
    return getEnv().PORT || '3000';
  },
  get HOST() {
    return getEnv().HOST || '0.0.0.0';
  },
  
  // sqld server configuration
  get SQLD_URL() {
    return getEnv().SQLD_URL || 'http://sqld:8080';
  },
  get SQLD_ADMIN_URL() {
    return getEnv().SQLD_ADMIN_URL || 'http://sqld:8081';
  },
  get SQLD_HOST_SUFFIX() {
    return getEnv().SQLD_HOST_SUFFIX || 'local';
  },
  
  // Authentication tokens
  get SQLD_AUTH_TOKEN() {
    return getEnv().SQLD_AUTH_TOKEN || '';
  },
  get SQLD_ADMIN_TOKEN() {
    return getEnv().SQLD_ADMIN_TOKEN || '';
  },
  // Optional Ed25519 private key for the token-generation UI. Missing keys
  // disable signing but must not fail startup.
  get SQLD_JWT_PRIVATE_KEY_FILE() {
    return getEnv().SQLD_JWT_PRIVATE_KEY_FILE || 'secrets/sqld-jwt-private.pem';
  },
  
  // Admin user credentials - NO hardcoded defaults
  get ADMIN_USER() {
    return getEnv().ADMIN_USER;
  },
  get ADMIN_PASSWORD() {
    return getEnv().ADMIN_PASSWORD;
  },
  
  // Security settings
  get ALLOW_NO_AUTH() {
    return getEnv().ALLOW_NO_AUTH === 'true';
  },
};

/**
 * Validate configuration and fail fast if required values are missing
 * or if auth is not configured and ALLOW_NO_AUTH is not true.
 * @throws {Error} with clear message if configuration is invalid
 */
function validateConfig() {
  const errors = [];
  
  // Check required server configuration
  if (!config.PORT) {
    errors.push('PORT is required');
  }
  
  if (!config.HOST) {
    errors.push('HOST is required');
  }
  
  // Check required sqld configuration
  if (!config.SQLD_URL) {
    errors.push('SQLD_URL is required');
  }
  
  if (!config.SQLD_ADMIN_URL) {
    errors.push('SQLD_ADMIN_URL is required');
  }
  
  if (!config.SQLD_HOST_SUFFIX) {
    errors.push('SQLD_HOST_SUFFIX is required');
  }
  
  // Check app login configuration. SQLD tokens are optional sqld credentials
  // and do not replace the admin login.
  if (!config.ALLOW_NO_AUTH && (!config.ADMIN_USER || !config.ADMIN_PASSWORD)) {
    errors.push(
      'ADMIN_USER and ADMIN_PASSWORD are required unless ALLOW_NO_AUTH=true. '
      + 'ALLOW_NO_AUTH=true is for local development only'
    );
  }
  
  if (errors.length > 0) {
    throw new Error(
      'Configuration validation failed:\n' + 
      errors.map((err, i) => `${i + 1}. ${err}`).join('\n') + 
      '\n\nSet ALLOW_NO_AUTH=true to bypass authentication for local development.'
    );
  }
}

// Validate configuration at module load (Phase 1 state)
validateConfig();

// Export configuration with named exports
export { config, validateConfig };