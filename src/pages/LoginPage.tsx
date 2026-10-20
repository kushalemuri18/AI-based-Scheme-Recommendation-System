import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { useNotifications } from '@/contexts/NotificationContext'

const API_URL = 'http://localhost:5001/api'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  // Forgot Password / Reset States
  const [mode, setMode] = useState<'login' | 'forgot' | 'reset'>('login')
  const [otp, setOtp] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const { addNotification } = useNotifications()
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })

      const data = await res.json()

      if (res.ok) {
        login(data.token, data)
        addNotification('Success', 'Successfully logged in!', 'success')
        navigate('/dashboard')
      } else {
        addNotification('Login Failed', data.message || 'Error', 'error')
      }
    } catch (err: any) {
      addNotification('Login Failed', err.message, 'error')
    }

    setLoading(false)
  }

  const handleRequestOTP = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const res = await fetch(`${API_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })

      const data = await res.json()

      if (res.ok) {
        addNotification('OTP Sent', 'A verification OTP has been sent to your email address.', 'success')
        setMode('reset')
      } else {
        addNotification('Failed to Send OTP', data.message || 'Error', 'error')
      }
    } catch (err: any) {
      addNotification('Error', err.message, 'error')
    }

    setLoading(false)
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()

    if (newPassword !== confirmPassword) {
      addNotification('Validation Error', 'Passwords do not match.', 'error')
      return
    }

    setLoading(true)

    try {
      const res = await fetch(`${API_URL}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp, password: newPassword })
      })

      const data = await res.json()

      if (res.ok) {
        addNotification('Success', 'Password has been reset successfully. Please log in.', 'success')
        setMode('login')
        setPassword('')
        setNewPassword('')
        setConfirmPassword('')
        setOtp('')
      } else {
        addNotification('Reset Failed', data.message || 'Error', 'error')
      }
    } catch (err: any) {
      addNotification('Error', err.message, 'error')
    }

    setLoading(false)
  }

  return (
    <>
      <PageHeader
        title={mode === 'login' ? 'Login' : mode === 'forgot' ? 'Reset Password' : 'New Password'}
        subtitle={mode === 'login' ? 'Access your saved schemes and profile' : mode === 'forgot' ? 'Request a password reset link' : 'Set a new password for your account'}
      />
      <section className="py-12 flex justify-center px-4">
        <Card className="w-full max-w-md">
          {mode === 'login' && (
            <>
              <CardHeader>
                <CardTitle>Welcome Back</CardTitle>
                <CardDescription>Enter your credentials to continue</CardDescription>
              </CardHeader>
              <form onSubmit={handleLogin}>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="name@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password">Password</Label>
                      <button
                        type="button"
                        onClick={() => {
                          setMode('forgot')
                        }}
                        className="text-xs text-primary hover:underline font-medium"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                </CardContent>
                <CardFooter className="flex flex-col gap-4">
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? 'Logging in...' : 'Log in'}
                  </Button>
                  <p className="text-sm text-center text-muted-foreground">
                    Don't have an account? <Link to="/signup" className="text-primary hover:underline font-medium">Sign up</Link>
                  </p>
                </CardFooter>
              </form>
            </>
          )}

          {mode === 'forgot' && (
            <>
              <CardHeader>
                <CardTitle>Forgot Password</CardTitle>
                <CardDescription>Enter your email below to request a 6-digit verification OTP.</CardDescription>
              </CardHeader>
              <form onSubmit={handleRequestOTP}>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="reset-email">Email Address</Label>
                    <Input
                      id="reset-email"
                      type="email"
                      placeholder="name@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                </CardContent>
                <CardFooter className="flex flex-col gap-4">
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? 'Sending OTP...' : 'Send OTP'}
                  </Button>
                  <div className="text-sm text-center">
                    <button
                      type="button"
                      onClick={() => setMode('login')}
                      className="text-primary hover:underline font-medium"
                    >
                      Back to Login
                    </button>
                  </div>
                </CardFooter>
              </form>
            </>
          )}

          {mode === 'reset' && (
            <>
              <CardHeader>
                <CardTitle>Create New Password</CardTitle>
                <CardDescription>Enter the OTP and your new password below.</CardDescription>
              </CardHeader>
              <form onSubmit={handleResetPassword}>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="otp">Verification OTP</Label>
                    <Input
                      id="otp"
                      type="text"
                      placeholder="123456"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      required
                      maxLength={6}
                      pattern="\d{6}"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-password">New Password</Label>
                    <Input
                      id="new-password"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">Confirm Password</Label>
                    <Input
                      id="confirm-password"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                    />
                  </div>
                </CardContent>
                <CardFooter className="flex flex-col gap-4">
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? 'Resetting Password...' : 'Reset Password'}
                  </Button>
                  <div className="flex justify-between w-full text-sm">
                    <button
                      type="button"
                      onClick={() => setMode('forgot')}
                      className="text-muted-foreground hover:text-foreground hover:underline text-xs"
                    >
                      Resend OTP
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('login')}
                      className="text-primary hover:underline text-xs font-medium"
                    >
                      Back to Login
                    </button>
                  </div>
                </CardFooter>
              </form>
            </>
          )}
        </Card>
      </section>
    </>
  )
}
