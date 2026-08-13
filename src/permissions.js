async function resolvePermissionStatus({ platform, getMediaAccessStatus, verifyScreenAccess }) {
  if (platform === 'darwin') {
    return {
      mic: getMediaAccessStatus('microphone'),
      screen: await verifyScreenAccess()
    };
  }

  if (platform === 'win32') {
    return {
      mic: getMediaAccessStatus('microphone'),
      screen: 'granted'
    };
  }

  return { mic: 'granted', screen: 'granted' };
}

module.exports = { resolvePermissionStatus };
