// Registers the Hardhat chai matchers explicitly. In installs with a mixed npm/pnpm node_modules the
// plugin's own registration doesn't always reach the chai instance the tests import. Registering the
// same plugin twice is harmless.
const chai = require("chai");
const { hardhatChaiMatchers } = require("@nomicfoundation/hardhat-chai-matchers/internal/hardhatChaiMatchers");

chai.use(hardhatChaiMatchers);
