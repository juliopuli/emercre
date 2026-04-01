const assert = require('assert');
function _bearingRad(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  lat1 = lat1 * Math.PI / 180; lat2 = lat2 * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return Math.atan2(y, x);
}
console.log(_bearingRad(36.7212, -4.4214, 36.7215, -4.4214)); // Should be 0 (North)
