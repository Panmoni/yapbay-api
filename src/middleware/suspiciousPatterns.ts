/**
 * Suspicious pattern definitions for request filtering.
 *
 * Organized by category so new patterns can be added in the right section
 * without touching detection logic in suspiciousPatternDetection.ts.
 *
 * All patterns are derived from real attack traffic observed in production logs.
 */

// ---------------------------------------------------------------------------
// Malicious path patterns
// ---------------------------------------------------------------------------

/** Dotfile / config exposure attempts */
const DOTFILE_PATTERNS: RegExp[] = [
  /^\/\.env/i,
  /^\/\.git/i,
  /^\/\.aws/i,
  /^\/\.ssh/i,
  /^\/\.htaccess/i,
  /^\/\.htpasswd/i,
  /^\/\.svn/i,
  /^\/\.vscode/i,
  /^\/\.serverless/i,
  /^\/\.ebextensions/i,
  /^\/\.DS_Store/i,
  /\.env$/i,
  /\.git\/config$/i,
  /\.aws\/credentials$/i,
  /\.env\?/i,
  /\.git\/config\?/i,
  /\.aws\/credentials\?/i,
];

/** CMS / admin panel scanning */
const CMS_PATTERNS: RegExp[] = [
  /^\/wp-admin/i,
  /^\/wp-login/i,
  /^\/wp-content/i,
  /^\/wp-includes/i,
  /^\/phpmyadmin/i,
  /^\/adminer/i,
];

/** PHP-specific exploit attempts */
const PHP_PATTERNS: RegExp[] = [
  /phpunit/i,
  /eval-stdin\.php/i,
  /phpinfo\.php/i,
  /\/storage\/logs/i, // Laravel log exposure
];

/** Framework / infrastructure probing */
const INFRA_PATTERNS: RegExp[] = [
  /^\/actuator/i, // Spring Boot actuator
  /^\/\.env\.save/i,
  /^\/backend\/\.env/i,
  /^\/home\/admin/i,
  /^\/aws-codecommit/i,
  /^\/careers_not_hosted/i,
  /\/SDK\/webLanguage/i, // Hikvision camera exploit
  /\/\+CSCOE\+/i, // Cisco VPN exploit
  /\/global-protect/i, // Palo Alto VPN exploit
];

/** Cloud / deployment config exposure */
const CLOUD_CONFIG_PATTERNS: RegExp[] = [
  /\/cdk\.context\.json/i, // AWS CDK
  /\/google-services\.json/i, // Firebase / Google
  /\/firebase/i, // Firebase config
  /\/aws-exports\.js/i, // AWS Amplify
  /\/package-lock\.json/i, // Dependency tree exposure
];

/** Backup / source map file scanning */
const BACKUP_PATTERNS: RegExp[] = [
  /\.js\.map$/i, // Source maps
  /\.(bak|sql|tar|gz|zip)$/i, // Backup archives
];

/** URL-encoding evasion attempts */
const ENCODING_PATTERNS: RegExp[] = [
  /%2f%2e/i, // URL-encoded ../
  /%252f%252e/i, // Double URL-encoded ../
];

/** All malicious path patterns combined */
export const MALICIOUS_PATH_PATTERNS: RegExp[] = [
  ...DOTFILE_PATTERNS,
  ...CMS_PATTERNS,
  ...PHP_PATTERNS,
  ...INFRA_PATTERNS,
  ...CLOUD_CONFIG_PATTERNS,
  ...BACKUP_PATTERNS,
  ...ENCODING_PATTERNS,
];

// ---------------------------------------------------------------------------
// Suspicious query string patterns
// ---------------------------------------------------------------------------

export const SUSPICIOUS_QUERY_PATTERNS: RegExp[] = [
  /XDEBUG_SESSION/i, // PHP debugger exploit
  /allow_url_include/i, // PHP remote inclusion
  /auto_prepend_file/i, // PHP code injection
  /php:\/\/input/i, // PHP stream wrapper injection
];

// ---------------------------------------------------------------------------
// Suspicious HTTP methods
// ---------------------------------------------------------------------------

export const SUSPICIOUS_METHODS: Set<string> = new Set([
  'PROPFIND', // WebDAV probing
  'SEARCH', // WebDAV search
  'MKCOL', // WebDAV directory creation
  'COPY', // WebDAV copy
  'MOVE', // WebDAV move
  'LOCK', // WebDAV lock
  'UNLOCK', // WebDAV unlock
  'TRACE', // HTTP TRACE (XST attacks)
]);

// ---------------------------------------------------------------------------
// Suspicious user agents
// ---------------------------------------------------------------------------

/** Generic HTTP client libraries (often used for scripted attacks) */
const SCRIPTING_AGENTS: RegExp[] = [
  /^curl/i,
  /^wget/i,
  /^python/i,
  /^go-http-client/i,
  /^libwww/i,
  /^lwp/i,
  /^java/i,
  /^perl/i,
  /^ruby/i,
  /^php/i,
  /^libredtail/i,
];

/** Known scanning / attack tools */
const SCANNER_AGENTS: RegExp[] = [
  /^masscan/i,
  /^nmap/i,
  /^nikto/i,
  /^sqlmap/i,
  /^acunetix/i,
  /^nessus/i,
  /^openvas/i,
  /^scanner/i,
  /censys/i, // CensysInspect internet scanner
  /palo alto/i, // Palo Alto Networks Cortex Xpanse scanner
];

/** Generic bot / crawler patterns */
const BOT_AGENTS: RegExp[] = [/^bot/i, /^crawler/i, /^spider/i, /^harvest/i, /^extract/i];

/** All suspicious user agent patterns combined */
export const SUSPICIOUS_USER_AGENTS: RegExp[] = [
  ...SCRIPTING_AGENTS,
  ...SCANNER_AGENTS,
  ...BOT_AGENTS,
];
