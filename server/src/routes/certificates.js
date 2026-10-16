/**
 * Bridge route — Certificate Studio API only (legacy canvas/PNG generators retired PR5).
 */
const express = require('express');
const router = express.Router();

const certificateStudio = require('./certificate-studio');

router.use('/', certificateStudio);

module.exports = router;
