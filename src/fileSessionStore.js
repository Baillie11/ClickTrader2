const fs = require("fs");
const path = require("path");
const session = require("express-session");

class FileSessionStore extends session.Store {
  constructor(options = {}) {
    super();
    this.filePath = options.filePath;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify({}, null, 2));
    }
  }

  readSessions() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch (error) {
      return {};
    }
  }

  writeSessions(sessions) {
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(sessions, null, 2));
    fs.renameSync(tempPath, this.filePath);
  }

  get(sid, callback) {
    const sessions = this.readSessions();
    const record = sessions[sid];
    if (!record) return callback(null, null);
    if (record.expiresAt && Date.now() > record.expiresAt) {
      delete sessions[sid];
      this.writeSessions(sessions);
      return callback(null, null);
    }
    return callback(null, record.session);
  }

  set(sid, sessionData, callback) {
    const sessions = this.readSessions();
    const maxAge = sessionData.cookie?.maxAge || 1000 * 60 * 60 * 24;
    sessions[sid] = {
      session: sessionData,
      expiresAt: Date.now() + maxAge
    };
    this.writeSessions(sessions);
    callback(null);
  }

  destroy(sid, callback) {
    const sessions = this.readSessions();
    delete sessions[sid];
    this.writeSessions(sessions);
    callback(null);
  }
}

module.exports = { FileSessionStore };
