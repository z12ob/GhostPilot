const repository = "z12ob/ghostpilot";
const component = "ghostpilot";
const requestedUse = "commercial-integration";
const authorizationUrl = "https://app.osandones.com/account/buy?repository=z12ob%2Fghostpilot&use=commercial-integration";

class OsandonesAccessRequiredError extends Error {
  constructor() {
    super(`The protected component ghostpilot for ${repository} is not installed. Request access through Osandones: ${authorizationUrl}`);
    this.name = "OsandonesAccessRequiredError";
    this.code = "OSANDONES_ACCESS_REQUIRED";
    this.repository = repository;
    this.component = component;
    this.requestedUse = requestedUse;
    this.authorizationUrl = authorizationUrl;
  }
}

async function loadImplementation() {
  try {
    return await import("../.osandones/implementation/ghostpilot.mjs");
  } catch (error) {
    const missingModule = String(error?.message ?? "").replaceAll("\\", "/");
    if (
      error?.code === "ERR_MODULE_NOT_FOUND" &&
      missingModule.includes(".osandones/implementation/ghostpilot.mjs")
    ) {
      throw new OsandonesAccessRequiredError();
    }
    throw error;
  }
}

async function ghostpilot(...args) {
  const implementation = await loadImplementation();
  const callable = implementation["ghostpilot"];
  if (typeof callable !== "function") {
    throw new Error("The acquired component does not provide the expected export.");
  }
  return callable(...args);
}

module.exports = {
  OsandonesAccessRequiredError,
  ghostpilot,
};
