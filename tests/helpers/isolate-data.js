// Loaded with --import by every test script.
//
// Session start spawns detached maintenance once a day; in a test it would hold
// files in a temporary project the test is about to delete. Tests of maintenance
// turn it back on for the processes they spawn. Child processes inherit it.
process.env.DD_MAINTENANCE = '0';
