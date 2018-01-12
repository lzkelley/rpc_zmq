RPC ZMQ
=======

A Remote Process Call (RPC) library using ZeroMQ via TCP, designed to communicated between a Python backend (server) and JavaScript frontend (client).  Based on the `zeromq.js` Node.js implementation, and the `pyzmq` python implementation, of ZeroMQ.

Run test scripts with:

    $ python test_server.py

    Then, in a new terminal,

    $ node test_client.js

    Both should communicate and exit automatically.
