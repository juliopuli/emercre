async function test() {
  const coords = [
    { name: 'Sur: Muelle Heredia', lat: 36.715694, lng: -4.417933 },
    { name: 'Suroeste: Plaza de Toros Vieja', lat: 36.713831, lng: -4.426214 },
    { name: 'Oeste: Av. Andalucía', lat: 36.717143, lng: -4.432240 },
    { name: 'Noroeste: Armengual de la Mota', lat: 36.721666, lng: -4.427774 },
    { name: 'Norte-Oeste 2: Gálvez Ginachero', lat: 36.725178, lng: -4.423719 },
    { name: 'Norte: Capuchinos', lat: 36.732926, lng: -4.422501 },
    { name: 'Este: Cristo Epidemia', lat: 36.731451, lng: -4.412174 },
    { name: 'Sureste: Paseo Reding', lat: 36.721415, lng: -4.410141 },
  ];
  console.log('Coordinates to check on a map:');
  coords.forEach(c => console.log(`${c.name}: https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`));
}
test();
