import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { Link as RouterLink } from "react-router-dom";

import { resetPassword } from "../api/auth";

function PasswordReset() {
    const [email, setEmail] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [submitting, setSubmitting] = useState(false);

    async function handleSubmit(event) {
        event.preventDefault();
        setSubmitting(true);
        setError("");
        setSuccess("");

        try {
            await resetPassword(email, newPassword);
            setSuccess("Password updated. You can sign in now.");
            setNewPassword("");
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
                <Typography variant="h4">Password reset</Typography>
                <Typography variant="body1" color="text.secondary">
                    Reset uses email + new password directly.
                </Typography>
                {error ? <Alert severity="error">{error}</Alert> : null}
                {success ? <Alert severity="success">{success}</Alert> : null}
                <TextField
                    label="Email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                />
                <TextField
                    label="New password"
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    required
                />
                <Stack direction="row" spacing={1}>
                    <Button type="submit" variant="contained" disabled={submitting}>
                        {submitting ? "Saving..." : "Reset password"}
                    </Button>
                    <Button component={RouterLink} to="/login" variant="outlined">
                        Back to login
                    </Button>
                </Stack>
            </Box>
        </Box>
    );
}

export default PasswordReset;
