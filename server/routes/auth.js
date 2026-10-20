import express from 'express'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { sendOTPEmail } from '../services/emailService.js'

const router = express.Router()

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'fallback_secret', {
    expiresIn: '30d'
  })
}

// Middleware to protect routes
export const protect = async (req, res, next) => {
  let token
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1]
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret')
      req.user = await User.findById(decoded.id).select('-password')
      next()
    } catch (error) {
      res.status(401).json({ message: 'Not authorized, token failed' })
    }
  } else {
    res.status(401).json({ message: 'Not authorized, no token' })
  }
}

router.post('/signup', async (req, res) => {
  const { full_name, email, password } = req.body
  try {
    const userExists = await User.findOne({ email })
    if (userExists) return res.status(400).json({ message: 'User already exists' })

    const user = await User.create({ full_name, email, password })
    if (user) {
      res.status(201).json({
        id: user._id,
        full_name: user.full_name,
        email: user.email,
        is_admin: user.is_admin,
        token: generateToken(user._id)
      })
    }
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

router.post('/login', async (req, res) => {
  const { email, password } = req.body
  try {
    const user = await User.findOne({ email })
    if (user && (await user.matchPassword(password))) {
      res.json({
        id: user._id,
        full_name: user.full_name,
        email: user.email,
        is_admin: user.is_admin,
        token: generateToken(user._id)
      })
    } else {
      res.status(401).json({ message: 'Invalid email or password' })
    }
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body
  try {
    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({ message: 'User not found with this email' })
    }

    // Generate a random 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString()

    // Save to user model with 15 minutes expiration
    user.resetPasswordOTP = otp
    user.resetPasswordOTPExpires = Date.now() + 15 * 60 * 1000
    await user.save()

    // Log the OTP in server console
    console.log(`[PASS RESET] OTP for user ${email}: ${otp}`)

    // Send the email (real SMTP or console simulation)
    const emailResult = await sendOTPEmail(email, otp)

    res.json({
      message: 'OTP verification code sent to your email address.'
    })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

router.post('/reset-password', async (req, res) => {
  const { email, otp, password } = req.body
  try {
    const user = await User.findOne({ email })
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    if (!user.resetPasswordOTP || user.resetPasswordOTP !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' })
    }

    if (user.resetPasswordOTPExpires < Date.now()) {
      return res.status(400).json({ message: 'OTP has expired' })
    }

    // Update password (will be hashed by pre-save hook)
    user.password = password
    // Clear OTP fields
    user.resetPasswordOTP = undefined
    user.resetPasswordOTPExpires = undefined
    await user.save()

    res.json({ message: 'Password updated successfully' })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

router.get('/me', protect, (req, res) => {
  res.json(req.user)
})

router.post('/change-password', protect, async (req, res) => {
  const { currentPassword, newPassword } = req.body
  try {
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new passwords are required' })
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ message: 'New password must be different from current password' })
    }

    const user = await User.findById(req.user._id)
    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    const isMatch = await user.matchPassword(currentPassword)
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid current password' })
    }

    user.password = newPassword
    await user.save()

    res.json({ message: 'Password changed successfully' })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// Get all users (admin only)
router.get('/users', protect, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ message: 'Forbidden' })
  try {
    const users = await User.find().select('-password')
    res.json(users)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

// Delete a user (admin only)
router.delete('/users/:id', protect, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ message: 'Forbidden' })
  try {
    await User.findByIdAndDelete(req.params.id)
    res.json({ message: 'User removed' })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
})

export default router
