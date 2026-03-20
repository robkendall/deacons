import { useEffect, useState } from "react";
import {
    BrowserRouter,
    Navigate,
    Route,
    Routes,
    useLocation,
} from "react-router-dom";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";

import { getCurrentUser } from "./api/auth";
import Navigation from "./components/Navigation";
import Benevolence from "./pages/Benevolence";
import RequireAuth from "./components/RequireAuth";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Logout from "./pages/Logout";
import PasswordReset from "./pages/PasswordReset";
import People from "./pages/People";
import Positions from "./pages/Positions";
import Schedule from "./pages/Schedule";
import UserProfile from "./pages/UserProfile";
import UsersManagement from "./pages/UsersManagement";
import Work from "./pages/Work";
import "./App.css";

const theme = createTheme({
    palette: {
        mode: "light",
        primary: {
            main: "#0f766e",
        },
        secondary: {
            main: "#c2410c",
        },
        background: {
            default: "#f4efe6",
            paper: "#fffaf2",
        },
    },
    typography: {
        fontFamily: '"Avenir Next", "Segoe UI", sans-serif',
    },
    shape: {
        borderRadius: 18,
    },
});

function AppRoutes({ authLoading, onLoggedOut, onUserChange, user }) {
    const location = useLocation();
    const isAuthPage = location.pathname === "/login" || location.pathname === "/password-reset";

    const appRoutes = (
        <Routes>
            <Route
                path="/login"
                element={
                    user ? <Navigate to="/" replace /> : <Login onAuthenticated={onUserChange} />
                }
            />
            <Route
                path="/password-reset"
                element={
                    user ? <Navigate to="/" replace /> : <PasswordReset />
                }
            />
            <Route path="/logout" element={<Logout onLoggedOut={onLoggedOut} />} />
            <Route
                path="/"
                element={
                    <RequireAuth authLoading={authLoading} user={user}>
                        <Dashboard user={user} />
                    </RequireAuth>
                }
            />
            <Route
                path="/profile"
                element={
                    <RequireAuth authLoading={authLoading} user={user}>
                        <UserProfile user={user} />
                    </RequireAuth>
                }
            />
            <Route
                path="/people"
                element={
                    <RequireAuth authLoading={authLoading} user={user}>
                        <People />
                    </RequireAuth>
                }
            />
            <Route
                path="/users"
                element={
                    <RequireAuth authLoading={authLoading} user={user}>
                        <UsersManagement />
                    </RequireAuth>
                }
            />
            <Route
                path="/positions"
                element={
                    <RequireAuth authLoading={authLoading} user={user}>
                        <Positions />
                    </RequireAuth>
                }
            />
            <Route
                path="/benevolence"
                element={
                    <RequireAuth authLoading={authLoading} user={user}>
                        <Benevolence />
                    </RequireAuth>
                }
            />
            <Route
                path="/work"
                element={
                    <RequireAuth authLoading={authLoading} user={user}>
                        <Work />
                    </RequireAuth>
                }
            />
            <Route
                path="/schedule"
                element={
                    <RequireAuth authLoading={authLoading} user={user}>
                        <Schedule />
                    </RequireAuth>
                }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );

    if (isAuthPage) {
        return appRoutes;
    }

    return (
        <div className="workspace-shell">
            <Navigation user={user} />
            <main className="workspace-main">{appRoutes}</main>
        </div>
    );
}

function App() {
    const [user, setUser] = useState(null);
    const [authLoading, setAuthLoading] = useState(true);

    useEffect(() => {
        let active = true;

        getCurrentUser()
            .then((currentUser) => {
                if (active) {
                    setUser(currentUser);
                }
            })
            .finally(() => {
                if (active) {
                    setAuthLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, []);

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <BrowserRouter>
                <AppRoutes
                    authLoading={authLoading}
                    onLoggedOut={() => setUser(null)}
                    onUserChange={setUser}
                    user={user}
                />
            </BrowserRouter>
        </ThemeProvider>
    );
}

export default App;
