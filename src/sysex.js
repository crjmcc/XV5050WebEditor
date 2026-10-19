/**
 * XV-5050 SysEx Message Builder & Parser
 * 
 * Handles construction and parsing of System Exclusive messages
 * for the XV-5050 synthesizer module.
 * 
 * Message format:
 *   F0 41 <dev> 00 10 <cmd> <addr[4]> <data...> <checksum> F7
 */

// Protocol constants
export const SYSEX_START = 0xF0;
export const SYSEX_END = 0xF7;
export const MANUFACTURER_ID = 0x41;
export const MODEL_ID = [0x00, 0x10]; // XV-5050
export const DEFAULT_DEVICE_ID = 0x10; // Device ID 17 (default)

// Command IDs
export const CMD_RQ1 = 0x11; // Data Request 1
export const CMD_DT1 = 0x12; // Data Set 1

/**
 * Calculate checksum for address + data bytes.
 * Formula: 128 - (sum % 128), if result is 128 use 0.
 * 
 * @param {number[]} bytes - Array of address and data bytes
 * @returns {number} Checksum byte (0x00-0x7F)
 */
export function calculateChecksum(bytes) {
  if (!Array.isArray(bytes) || bytes.length === 0) {
    throw new Error('Checksum requires a non-empty array of bytes');
  }
  const sum = bytes.reduce((acc, byte) => acc + (byte & 0x7F), 0);
  const checksum = 128 - (sum % 128);
  return checksum === 128 ? 0x00 : checksum;
}

/**
 * Validate a checksum against address + data bytes.
 * 
 * @param {number[]} bytes - Address and data bytes
 * @param {number} checksum - Checksum byte to validate
 * @returns {boolean} True if checksum is valid
 */
export function validateChecksum(bytes, checksum) {
  return calculateChecksum(bytes) === checksum;
}

/**
 * Build a Data Set 1 (DT1) SysEx message.
 * Used to send parameter values to the device.
 * 
 * @param {number[]} address - 4-byte parameter address [aa, bb, cc, dd]
 * @param {number[]} data - Data bytes to send
 * @param {number} [deviceId=DEFAULT_DEVICE_ID] - Device ID (0x10-0x1F)
 * @returns {Uint8Array} Complete SysEx message
 */
export function buildDT1(address, data, deviceId = DEFAULT_DEVICE_ID) {
  validateAddress(address);
  validateDeviceId(deviceId);
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Data must be a non-empty array');
  }

  const checksumBytes = [...address, ...data];
  const checksum = calculateChecksum(checksumBytes);

  return new Uint8Array([
    SYSEX_START,
    MANUFACTURER_ID,
    deviceId,
    ...MODEL_ID,
    CMD_DT1,
    ...address,
    ...data,
    checksum,
    SYSEX_END,
  ]);
}

/**
 * Build a Data Request 1 (RQ1) SysEx message.
 * Used to request parameter data from the device.
 * 
 * @param {number[]} address - 4-byte start address [aa, bb, cc, dd]
 * @param {number[]} size - 4-byte data size [ss, ss, ss, ss]
 * @param {number} [deviceId=DEFAULT_DEVICE_ID] - Device ID
 * @returns {Uint8Array} Complete SysEx message
 */
export function buildRQ1(address, size, deviceId = DEFAULT_DEVICE_ID) {
  validateAddress(address);
  if (!Array.isArray(size) || size.length !== 4) {
    throw new Error('Size must be a 4-byte array');
  }
  validateDeviceId(deviceId);

  const checksumBytes = [...address, ...size];
  const checksum = calculateChecksum(checksumBytes);

  return new Uint8Array([
    SYSEX_START,
    MANUFACTURER_ID,
    deviceId,
    ...MODEL_ID,
    CMD_RQ1,
    ...address,
    ...size,
    checksum,
    SYSEX_END,
  ]);
}

/**
 * Parse an incoming SysEx message from the XV-5050.
 * 
 * @param {Uint8Array} message - Raw SysEx message bytes
 * @returns {object} Parsed message with { command, address, data, deviceId, valid }
 */
export function parseSysEx(message) {
  if (!(message instanceof Uint8Array) && !Array.isArray(message)) {
    throw new Error('Message must be a Uint8Array or Array');
  }

  const bytes = Array.from(message);

  // Minimum valid message: F0 41 dev 00 10 cmd addr[4] data[1] checksum F7 = 13 bytes
  if (bytes.length < 13) {
    return { valid: false, error: 'Message too short' };
  }

  if (bytes[0] !== SYSEX_START) {
    return { valid: false, error: 'Missing SysEx start byte' };
  }

  if (bytes[bytes.length - 1] !== SYSEX_END) {
    return { valid: false, error: 'Missing SysEx end byte' };
  }

  if (bytes[1] !== MANUFACTURER_ID) {
    return { valid: false, error: `Wrong manufacturer ID: 0x${bytes[1].toString(16)}` };
  }

  const deviceId = bytes[2];

  if (bytes[3] !== MODEL_ID[0] || bytes[4] !== MODEL_ID[1]) {
    return { valid: false, error: `Wrong model ID: 0x${bytes[3].toString(16)} 0x${bytes[4].toString(16)}` };
  }

  const command = bytes[5];
  if (command !== CMD_DT1 && command !== CMD_RQ1) {
    return { valid: false, error: `Unknown command: 0x${command.toString(16)}` };
  }

  const address = bytes.slice(6, 10);
  const data = bytes.slice(10, bytes.length - 2);
  const receivedChecksum = bytes[bytes.length - 2];

  const checksumBytes = [...address, ...data];
  const valid = validateChecksum(checksumBytes, receivedChecksum);

  return {
    valid,
    command,
    address,
    data,
    deviceId,
    error: valid ? null : 'Invalid checksum',
  };
}

/**
 * Convert an address array to a comparable string key.
 * 
 * @param {number[]} address - 4-byte address array
 * @returns {string} Hex string like "10-00-00-00"
 */
export function addressToString(address) {
  return address.map(b => b.toString(16).padStart(2, '0')).join('-');
}

/**
 * Convert a hex string key back to an address array.
 * 
 * @param {string} str - Hex string like "10-00-00-00"
 * @returns {number[]} 4-byte address array
 */
export function stringToAddress(str) {
  return str.split('-').map(s => parseInt(s, 16));
}

/**
 * Format a SysEx message as a hex dump string for debugging.
 * 
 * @param {Uint8Array|number[]} message - SysEx message bytes
 * @returns {string} Formatted hex string
 */
export function formatSysEx(message) {
  return Array.from(message)
    .map(b => b.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ');
}

// -- Internal validators --

function validateAddress(address) {
  if (!Array.isArray(address) || address.length !== 4) {
    throw new Error('Address must be a 4-byte array');
  }
  for (const byte of address) {
    if (byte < 0 || byte > 0x7F) {
      throw new Error(`Address byte out of range: 0x${byte.toString(16)}`);
    }
  }
}

function validateDeviceId(deviceId) {
  if (deviceId < 0x00 || deviceId > 0x1F) {
    throw new Error(`Device ID out of range: 0x${deviceId.toString(16)}`);
  }
}
