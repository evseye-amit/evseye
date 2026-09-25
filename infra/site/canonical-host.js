function handler(event) {
  var request = event.request;
  if (request.headers.host && request.headers.host.value === 'evseye.com') {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        location: { value: 'https://www.evseye.com' + request.uri }
      }
    };
  }
  return request;
}
