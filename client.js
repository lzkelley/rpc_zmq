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
 */
class JSClient {
    /**
     * Create a JSClient instance.
     *
     * @param {str} uri - Location to communicate with via TCP.
     * @param {str} port - Port to access on URI.
     * @param {int} timeout - Timeout interval in milliseconds.
     */
    constructor(uri="127.0.0.1", port="3000", timeout=5000) {
        let addr = "tcp://" + uri + ":" + port;
        console.log("Initializing %s socket", SOCKET_TYPE);
        let socket = zmq.socket(SOCKET_TYPE);
        // sock.bindSync('tcp://127.0.0.1:3000');
        socket.connect(addr);
        console.log('Connected to ', addr);

        this.addr = addr;
        this._socket = socket;
        this._killer = null;
        this._timeout = timeout;
        this._payload_name = null;
        this._payload_arg = null;
        this._payload_func = null;
    }

    /**
     * Perform a single communication heartbeat (send and recv combination).
     */
    _beat() {
        let self = this;
        // Send payload after heartbeat
        if (this._payload_name != null) {
            console.log("\tSending beat with payload");
            this._socket.send("beat", zmq.ZMQ_SNDMORE);
            this._socket.send(this._payload_name, zmq.ZMQ_SNDMORE);
            this._socket.send(this._payload_arg);
            // Reset (`func` reset later)
            this._payload_name = null;
            this._payload_arg = null;
        }
        // No payload to send
        else {
            console.log("\tSending beat");
            this._socket.send("beat");
        }

        this._killer = setTimeout(function() {
          console.log("Nothing received. Exiting...");
          self._socket.close();
          throw new Error("Connection timeout!")
        }, this._timeout);
    }

    /**
     * Begin heartbeat communicated with the `PyServer`.
     */
    run() {
      let self = this;
      this._socket.on('message', function(msg) {
        console.log("recieved: " + msg);
        clearTimeout(self._killer);

        let ind = msg.indexOf(PAYLOAD_STR);
        if (ind >= 0) {
            let start = ind + PAYLOAD_STR.length;
            let response = msg.toString().substr(start, msg.length-start);
            let error = (response.substr(0, 5) == "error");

            if (self._payload_func == null || error) {
                console.log("Response: '%s'", response);
                if (self._payload_func == null) {
                    throw new Error("Received payload response, no function set!");
                } else {
                    console.log("Error returned, not calling response function!");
                }
            } else {
                self._payload_func(response);
            }
            // Reset payload response function
            self._payload_func = null;
        } else if (self._payload_func != null ) {
            console.log("WARNING: payload function set, but no return value!")
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

}

jsc = new JSClient();
jsc.run();

setTimeout(function() {
  console.log("Trying to add a payload...");
  jsc.call("echo", "Hello", function (msg) {
      console.log("Received: ", msg);
  });
}, 2000);

setTimeout(function() {
  console.log("Trying to add a payload...");
  jsc.call("_echo", "Hello", function (msg) {
      console.log("Received: ", msg);
  });
}, 4000);
