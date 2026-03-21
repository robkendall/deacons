import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { Link as RouterLink, useLocation, useNavigate } from "react-router-dom";

import { login } from "../api/auth";

function Login({ onAuthenticated }) {
    const location = useLocation();
    const navigate = useNavigate();
    const [email, setEmail] = useState("rob@example.com");
    const [password, setPassword] = useState("asdf");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const redirectTarget = location.state?.from?.pathname || "/";

    async function handleSubmit(event) {
        event.preventDefault();
        setSubmitting(true);
        setError("");

        try {
            const user = await login(email, password);
            onAuthenticated(user);
            navigate(redirectTarget, { replace: true });
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Box className="auth-layout">
            <Box component="form" className="auth-card form-stack" onSubmit={handleSubmit}>
                <Typography variant="overline" sx={{ color: "primary.main", letterSpacing: "0.18em" }}>
                    Scheduler
                </Typography>
                <Typography variant="h3">Sign in</Typography>
                <Typography variant="body1" color="text.secondary">
                    Starter account: <strong>rob@example.com</strong> / <strong>asdf</strong>
                </Typography>
                {error ? <Alert severity="error">{error}</Alert> : null}
                <TextField
                    label="Email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                />
                <TextField
                    label="Password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                />
                <Stack direction="row" spacing={1}>
                    <Button type="submit" variant="contained" disabled={submitting}>
                        {submitting ? "Signing in..." : "Sign in"}
                    </Button>
                    <Button component={RouterLink} to="/password-reset" variant="outlined">
                        Reset password
                    </Button>
                </Stack>
            </Box>
        </Box>
    );
}

export default Login;
