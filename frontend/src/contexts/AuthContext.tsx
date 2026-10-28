'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  // What this user's role may open and do (Role Access page). ADMIN has everything.
  permissions?: string[];
}

interface RegistrationDetails {
  name: string;
  email: string;
  password: string;
}

interface AuthResponse {
  token?: string;
  user?: User;
  error?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (details: RegistrationDetails) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
  /** Whether the signed-in user's role has a permission, e.g. can('pdi.check'). */
  can: (permission: string) => boolean;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const storedToken = localStorage.getItem('token');

    if (!storedToken) {
      queueMicrotask(() => {
        if (!cancelled) setLoading(false);
      });
      return () => { cancelled = true; };
    }

    const controller = new AbortController();
    fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${storedToken}` },
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json()) as AuthResponse;
        if (!response.ok || !data.user || !data.user.isActive) {
          throw new Error(data.error || 'Invalid stored session');
        }
        return data.user;
      })
      .then((nextUser) => {
        if (cancelled) return;
        localStorage.setItem('token', storedToken);
        localStorage.setItem('user', JSON.stringify(nextUser));
        setToken(storedToken);
        setUser(nextUser);
      })
      .catch(() => {
        if (cancelled) return;
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const setSession = (nextToken: string, nextUser: User) => {
    localStorage.setItem('token', nextToken);
    localStorage.setItem('user', JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
  };

  const login = async (email: string, password: string) => {
    const response = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = (await response.json()) as AuthResponse;

    if (!response.ok) {
      throw new Error(data.error || 'Login failed');
    }

    if (!data.token || !data.user) {
      throw new Error('Invalid login response');
    }

    setSession(data.token, data.user);
  };

  const register = async ({ name, email, password }: RegistrationDetails) => {
    const response = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    const data = (await response.json()) as AuthResponse;

    if (!response.ok) {
      throw new Error(data.error || 'Registration failed');
    }

    if (!data.token || !data.user) {
      throw new Error('Invalid registration response');
    }

    setSession(data.token, data.user);
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        register,
        logout,
        isAuthenticated: !!user && !!token,
        can: (permission: string) => !!user && (user.role === 'ADMIN' || !!user.permissions?.includes(permission)),
      }}
    >
      {!loading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
