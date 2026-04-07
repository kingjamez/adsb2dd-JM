/// @brief Helper to check if a value is a valid number.
/// @param value Value to check.
/// @return True is value is valid.
export function isValidNumber(value) {
  return value !== null && value !== '' && Number.isFinite(Number(value));
}
