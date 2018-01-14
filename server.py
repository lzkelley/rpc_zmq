"""
"""

import zmq
import time
from datetime import datetime

SOCKET_TYPE = zmq.PAIR


class PyServer:

    _BEAT_BOUNDS = [0.001, 1.0]   # seconds
    _PAYLOAD_STR = ":::"
    # _RUN_COUNT_LIMIT = 100  # seconds

    def __init__(self, uri="127.0.0.1", port="3000",
                 type=zmq.PAIR, debug=False, file=None):
        """Class for communicating with a `JSClient` using ZeroMQ via TCP.

        Socket is initialized and open to connect upon initialization.
        PyServer communicates using a 'heartbeat' pattern, started with the
        `run` method.  In this pattern, every <INTERVAL> time-period, the class
        calls the `_beat()` method which communicates with the connected
        `JSClient` class.  On each 'beat', the PyServer waits for a message from
        the `JSClient`, then returns a response.

        Additional communication is performed by adding additional messages.
        The `JSClient` makes a request by sending addition messages, called the
        'payload', after its initial 'beat' message.  The `PyServer` parses
        the payload and sends a response added onto its 'beat' message.
        In particular, `PyServer` expects a payload composed of a function name,
        and an argument.  The function must be a non-protected method of
        `PyServer` (or of a subclass).  The function is called with the given
        argument, and the return value is passed back to `JSClient`.

        Arguments
        ---------
        uri : str
            Location to communicate with via TCP.
        port : str or int
            Port to access on URI.
        type : int
            Type of ZeroMQ connection to make (e.g. `zmq.PAIR`).
        debug : bool
            Print debugging output.

        """
        self._debug = debug
        self._file = file
        context = zmq.Context()
        self._log("Initializing '{}' socket".format(SOCKET_TYPE))
        socket = context.socket(SOCKET_TYPE)

        addr = "tcp://{uri}:{port}".format(uri=uri, port=port)
        self._log("Address: '{}'".format(addr))
        socket.bind(addr)
        # Set the 'high-water mark' to 100MB (close if buffer exceeds this)
        # socket.setsockopt(zmq.HWM, 100)
        # Set the time to wait 'linger' without sending/recieving a message [ms]
        socket.setsockopt(zmq.LINGER, 5000)

        self.addr = addr
        self._context = context
        self._socket = socket
        self._stop_flag = False
        self._connected = None
        return

    def run(self, beat=1.0):
        """Begin heartbeat communication with the `JSClient`.

        Arguments
        ---------
        beat : scalar
            Heartbeat interval in seconds.

        """
        if (beat > self._BEAT_BOUNDS[1]) or (beat < self._BEAT_BOUNDS[0]):
            msg = "`beat` = '{}' out of bounds: {}".format(
                beat, self._BEAT_BOUNDS)
            raise ValueError(msg)

        count = 0
        self._log("Beginning heartbeat")

        while (not self._stop_flag):
            count = self._beat(count)
            time.sleep(beat)
            # if count > self._RUN_COUNT_LIMIT:
            #     self._log("Breaking!  count = {} > {} count limit.".format(
            #         count, self._RUN_COUNT_LIMIT))
            #     self._stop_flag = True

        self._log("Heartbeat terminated.")

        return

    def _stop(self):
        """End the heartbeat loop.

        Sends a 'stopped' message to the `JSClient`.

        """
        self._log("Terminating heartbeat...")
        self._stop_flag = True
        self._respond(msg="STOPPED")
        return

    def _beat(self, count):
        """Perform a single heartbeat: a recieve and send sequence.

        Arguments
        ---------
        count : int
            Number of heartbeats recorded before this one.

        Returns
        -------
        count : int
            Number of heartbeats recorded including this one.

        """
        MORE_LIMIT = 10
        result = None
        error = None

        # Receive message
        msg = self._recv()
        count += 1
        self._log("Recieved: '{}' ({:04d})".format(msg, count))
        if msg.startswith('STOP'):
            self._stop()
            return count

        more = self._socket.getsockopt(zmq.RCVMORE)
        if more:
            self._log("\tPayload attached")
            packet = []
            more_count = 0
            while more:
                msg = self._recv()
                more_count += 1
                packet.append(msg)
                self._log("\t{}: '{}'".format(count, msg))
                more = bool(self._socket.getsockopt(zmq.RCVMORE))
                self._log("\t\tmore = {}".format(str(more)))

                if more_count > MORE_LIMIT:
                    err = "Count = {} > {}! breaking".format(
                        more_count, MORE_LIMIT)
                    self._log(err)
                    raise RuntimeError(err)

            self._log("\tPacket collected")
            self._log("\t'{}'".format(packet))
            try:
                if len(packet) != 2:
                    raise ValueError("Packet was not length 2!")
                func = packet[0]
                arg = packet[1]
                if func.startswith('_'):
                    raise ValueError("Cannot call internal methods!")
                # Get result from target function
                result = getattr(self, func)(arg)
            except Exception as err:
                self._log("ERROR parsing packet: '{}'".format(err))
                error = "Malformed packet: '{}'".format(err)

        # Send response
        self._respond(result=result, error=error)
        return count

    def _respond(self, msg="beat", result=None, error=None):
        """Respond to the `JSClient`.

        Response is of the form "{msg}[{sep}{additional}]", where 'msg' is the
        base message of the response.  If there is a `result` or `error` value,
        then a separation str (`_PAYLOAD_STR`) is added, followed by the
        additional values.  If `result` is given, then that is added literally.
        If `error` is given, then it is appended after an 'error: ' string.

        e.g.
            -   Normal heartbeat:   "beat"
            -   Result heartbeat:   "beat:::2.2345"
            -   Error  heartbeat:   "beat:::error: ERROR MESSAGE"

        Arguments
        ---------
        msg : str
            Base message to send.
        result : str
            Result value to send.
        error : str
            Error message to send.

        """
        # Add response payload
        if (error is not None) or (result is not None):
            msg += self._PAYLOAD_STR
            # Add error message
            if error is not None:
                msg += "error: {}".format(error)
            elif result is not None:
                msg += str(result)

        self._log("\t\tSending: '{}'".format(msg))
        self._socket.send_string(msg)
        return

    def echo(self, msg):
        """Testing method generallly used to confirm connection.

        Arguments
        ---------
        msg : str
            Input message.

        Returns
        -------
        msg : str
            The unaltered input message.

        """
        return msg

    def _recv(self):
        """Wait for a message from the `JSClient` and parse.
        """
        msg = self._socket.recv().decode("utf-8", "strict")
        return msg

    def _log(self, msg):
        """Handle logging and output.

        Arguments
        ---------
        msg : str
            Message to log and/or output.

        """
        _msg = "{}:: {}".format(str(datetime.now()), msg)
        if self._debug:
            print(_msg)

        if (self._file is not None):
            self._file.write(_msg + "\n")
            self._file.flush()

        return
