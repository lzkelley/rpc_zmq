/*
 *
 */

var zmq = require('zeromq');

var PAYLOAD_STR = ":::";
var SOCKET_TYPE = "pair";

/**
 * Class for communicating with a `PyServer` using ZeroMQ via TCP.
 *
 * On each 'beat', a mesage is always sent, and a timer is initialized which
 * will cause a timeout if a response is not recieved before it goes off. If an
 * addition message is being sent (called a 'payload'), then subsequent messages
 * are sent to the `PyServer`.  The payload takes the form of two messages:
 * first a function-name and then an argument (both strings).
 *
 * On the `PyServer` side, the given function is called with the given argument,
 * and the return value is passed on the subsequent heartbeat response.
 *
 * When this `JSClient` doesn't get a response within a given time (`timeout`), the method,
 * `JSClient.timeoutFunc` will be called.  This can be reset to point to a function which does
 * some sort of recovery action, for example: restarting/recreating the `PyServer` and creating
 * a new JSClient.
 *
 */
class JSClient {
    /**
     * Create a JSClient instance.
     *
     * @param {str} uri - Location to communicate with via TCP.
     * @param {str} port - Port to access on URI.
     * @param {int} timeout - Timeout interval in milliseconds.
     */
    constructor(uri="127.0.0.1", port="3000", timeout=5000, debug=false, timeoutFunc=null) {
        let addr = "tcp://" + uri + ":" + port;
        this._log("Initializing %s socket", SOCKET_TYPE, debug=true);
        let socket = zmq.socket(SOCKET_TYPE);
        console.log("Starting connection to", addr);
        socket.connect(addr);
        this._log('Connected to ', addr);

        this.addr = addr;
        this._socket = socket;
        this._debug = debug;
        this._killer = null;
        this._timeout = timeout;
        this._payload_name = null;
        this._payload_arg = null;
        this._payload_func = null;
        if (timeoutFunc == null) {
            timeoutFunc = this._timeoutError;
        }
        this.timeoutFunc = timeoutFunc;
    }

    _timeoutError() {
        throw new Error("Connection timeout!");
    }

    /**
     * Perform a single communication heartbeat (send and recv combination).
     */
    _beat() {
        let self = this;
        // Send payload after heartbeat
        if (this._payload_name != null) {
            this._log("\tSending beat with payload");
            this._socket.send("beat", zmq.ZMQ_SNDMORE);
            this._socket.send(this._payload_name, zmq.ZMQ_SNDMORE);
            this._socket.send(this._payload_arg);
            // Reset (`func` reset later)
            this._payload_name = null;
            this._payload_arg = null;
        }
        // No payload to send
        else {
            this._log("\tSending beat");
            this._socket.send("beat");
        }

        this._killer = setTimeout(function() {
            self._log("Nothing received. Exiting...");
            self._socket.close();
            self.timeoutFunc();
        }, this._timeout);
    }

    /**
     * Begin heartbeat communicated with the `PyServer`.
     */
    run() {
      let self = this;
      this._socket.on('message', function(msg) {
        self._log("recieved: " + msg);
        clearTimeout(self._killer);

        let ind = msg.indexOf(PAYLOAD_STR);
        if (ind >= 0) {
            let start = ind + PAYLOAD_STR.length;
            let response = msg.toString().substr(start, msg.length-start);
            let error = (response.substr(0, 5) == "error");

            if (self._payload_func == null || error) {
                self._log("Response: '%s'", response);
                if (self._payload_func == null) {
                    let err = "Received payload response, no function set!";
                    console.error(err);
                    // throw new Error(err);
                } else {
                    self._log("Error returned, not calling response function!");
                }
            } else {
                self._payload_func(response);
            }
            // Reset payload response function
            self._payload_func = null;
        } else if (self._payload_func != null ) {
            self._log("WARNING: payload function set, but no return value!")
        }

        self._beat();
      });

      self._beat();
    }

    /**
     * Request a function call from the `PyServer`.
     *
     * @param {string} name - The `PyServer` function name to be called.
     * @param {string} arg - The argument to be included in the `PyServer`
     *                       function call.
     * @param {function} func - The to call with the result returned from the
     *                          `PyServer`.  Must accept a single argument.
     */
    call(name, arg, func) {
        this._payload_name = name;
        this._payload_arg = arg;
        this._payload_func = func;
    }

    stop() {
        var stopFailed;
        var self = this;
        this._socket.on('message', function(msg) {
          self._log("recieved: " + msg);
          if (msg == "STOPPED") {
              clearTimeout(self._killer);
              self._log("Server successfully exited.")
              self._socket.send("STOP");
          }
        });

        stopFailed = setTimeout(function() {
            self._log("No stopped signal recieved!");
            self._socket.close();
            throw new Error("Connection timeout during stop signal!")
        }, this._timeout);

    }

    _log(msg, debug=null) {
        // Set default debug value
        if (debug == null) {
            debug = this._debug;
        }

        if (debug) {
            let _msg = getDateTime() + " :: " + msg;
            console.log(_msg);
        }
    }

}

function getDateTime() {
    var date = new Date();
    var hour = date.getHours();
    hour = (hour < 10 ? "0" : "") + hour;
    var min  = date.getMinutes();
    min = (min < 10 ? "0" : "") + min;
    var sec  = date.getSeconds();
    sec = (sec < 10 ? "0" : "") + sec;
    var year = date.getFullYear();
    var month = date.getMonth() + 1;
    month = (month < 10 ? "0" : "") + month;
    var day  = date.getDate();
    day = (day < 10 ? "0" : "") + day;
    return year + ":" + month + ":" + day + " " + hour + ":" + min + ":" + sec;
}

module.exports = JSClient;
