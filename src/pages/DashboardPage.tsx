import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useNotifications } from '@/contexts/NotificationContext'

const API_URL = '/api'

export function DashboardPage() {
  const { user, logout } = useAuth()
  const [savedSchemes, setSavedSchemes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  // Change Password States
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [changeLoading, setChangeLoading] = useState(false)
  const { addNotification } = useNotifications()

  useEffect(() => {
    const fetchDashboardData = async () => {
      setLoading(true)
      const token = localStorage.getItem('token')

      if (!token) {
        setLoading(false)
        return
      }

      try {
        const res = await fetch(`${API_URL}/schemes/saved/list`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (res.ok) {
          const data = await res.json()
          setSavedSchemes(data || [])
        }
      } catch (err) {
        console.error('Failed to fetch saved schemes', err)
      }

      setLoading(false)
    }

    fetchDashboardData()
  }, [])

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()

    if (newPassword !== confirmNewPassword) {
      addNotification('Validation Error', 'New passwords do not match.', 'error')
      return
    }

    if (currentPassword === newPassword) {
      addNotification('Validation Error', 'New password must be different from current password.', 'error')
      return
    }

    setChangeLoading(true)
    const token = localStorage.getItem('token')

    try {
      const res = await fetch(`${API_URL}/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ currentPassword, newPassword })
      })

      const data = await res.json()

      if (res.ok) {
        addNotification('Success', 'Password changed successfully!', 'success')
        setShowChangePassword(false)
        setCurrentPassword('')
        setNewPassword('')
        setConfirmNewPassword('')
      } else {
        addNotification('Failed to change password', data.message || 'Error', 'error')
      }
    } catch (err: any) {
      addNotification('Error', err.message, 'error')
    }

    setChangeLoading(false)
  }

  const handleUnsave = async (schemeId: string) => {
    const token = localStorage.getItem('token')
    if (!token) {
      addNotification('Error', 'You must be logged in to unsave schemes.', 'error')
      return
    }
    try {
      console.log('[Unsave] Sending DELETE to', `${API_URL}/schemes/saved/${schemeId}`)
      const res = await fetch(`${API_URL}/schemes/saved/${schemeId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json().catch(() => ({}))
      console.log('[Unsave] Response:', res.status, data)
      if (res.ok) {
        setSavedSchemes((prev) => prev.filter((s) => s._id !== schemeId))
        addNotification('Success', 'Scheme removed from your saved list.', 'success')
      } else {
        addNotification('Error', data.message || `Failed to unsave (${res.status})`, 'error')
      }
    } catch (err: any) {
      console.error('[Unsave] Error:', err)
      addNotification('Error', err.message || 'Network error', 'error')
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-24 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <div className="mt-8">
          <Skeleton className="h-48 w-full max-w-2xl" />
        </div>
      </div>
    )
  }

  return (
    <>
      <PageHeader title="Your Dashboard" subtitle="Manage your profile and saved schemes" />
      <section className="py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid gap-8 lg:grid-cols-3">

            {/* Profile Section */}
            <div className="lg:col-span-1 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Profile Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Name</p>
                    <p className="font-medium">{user?.full_name || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Email</p>
                    <p className="font-medium">{user?.email}</p>
                  </div>
                  {!showChangePassword ? (
                    <Button
                      variant="outline"
                      className="w-full mb-2"
                      onClick={() => setShowChangePassword(true)}
                    >
                      Change Password
                    </Button>
                  ) : (
                    <form onSubmit={handleChangePassword} className="space-y-3 mb-4 p-3 bg-muted/40 rounded-lg border border-border/80 text-left">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Change Password</p>

                      <div className="space-y-1">
                        <Label htmlFor="currentPassword">Current Password</Label>
                        <Input
                          id="currentPassword"
                          type="password"
                          required
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                        />
                      </div>

                      <div className="space-y-1">
                        <Label htmlFor="newPassword">New Password</Label>
                        <Input
                          id="newPassword"
                          type="password"
                          required
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                        />
                      </div>

                      <div className="space-y-1">
                        <Label htmlFor="confirmNewPassword">Confirm New Password</Label>
                        <Input
                          id="confirmNewPassword"
                          type="password"
                          required
                          value={confirmNewPassword}
                          onChange={(e) => setConfirmNewPassword(e.target.value)}
                        />
                      </div>

                      <div className="flex gap-2 pt-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="flex-1 text-xs"
                          onClick={() => {
                            setShowChangePassword(false)
                            setCurrentPassword('')
                            setNewPassword('')
                            setConfirmNewPassword('')
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="submit"
                          size="sm"
                          className="flex-1 text-xs"
                          disabled={changeLoading}
                        >
                          {changeLoading ? 'Updating...' : 'Update'}
                        </Button>
                      </div>
                    </form>
                  )}

                  <Button variant="outline" className="w-full" onClick={handleLogout}>
                    Log out
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Saved Schemes Section */}
            <div className="lg:col-span-2">
              <div className="grid gap-8">
                <div>
                  <h2 className="text-2xl font-semibold mb-6">Saved Schemes</h2>
                  {savedSchemes.length === 0 ? (
                    <Card>
                      <CardContent className="py-12 text-center text-muted-foreground">
                        <p>You haven't saved any schemes yet.</p>
                        <Link to="/schemes">
                          <Button className="mt-4" variant="outline">Browse Schemes</Button>
                        </Link>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2">
                      {savedSchemes.map((scheme) => (
                        <Card key={scheme._id} className="flex flex-col h-full">
                          <CardHeader>
                            <CardTitle className="line-clamp-1">{scheme.name}</CardTitle>
                            <CardDescription>{scheme.ministry}</CardDescription>
                          </CardHeader>
                          <CardContent className="flex-1">
                            <p className="text-sm text-muted-foreground line-clamp-3">
                              {scheme.description}
                            </p>
                          </CardContent>
                          <div className="p-6 pt-0 mt-auto flex gap-2">
                            <Link to={`/schemes/${scheme.slug}`} className="flex-1">
                              <Button variant="secondary" className="w-full">View Details</Button>
                            </Link>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleUnsave(scheme._id)}
                              className="text-destructive border-destructive/30 hover:bg-destructive/10"
                            >
                              Unsave
                            </Button>
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>
    </>
  )
}
