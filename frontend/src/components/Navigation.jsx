import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import DashboardRoundedIcon from "@mui/icons-material/DashboardRounded";
import EventNoteRoundedIcon from "@mui/icons-material/EventNoteRounded";
import FactCheckRoundedIcon from "@mui/icons-material/FactCheckRounded";
import FavoriteRoundedIcon from "@mui/icons-material/FavoriteRounded";
import GroupRoundedIcon from "@mui/icons-material/GroupRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import PersonRoundedIcon from "@mui/icons-material/PersonRounded";
import VolunteerActivismRoundedIcon from "@mui/icons-material/VolunteerActivismRounded";
import WorkOutlineRoundedIcon from "@mui/icons-material/WorkOutlineRounded";
import { useState } from "react";
import { Link as RouterLink, useLocation } from "react-router-dom";

const pageLinks = [
    { icon: <DashboardRoundedIcon />, label: "Dashboard", to: "/" },
    { icon: <FavoriteRoundedIcon />, label: "Widows", to: "/widows" },
    { icon: <VolunteerActivismRoundedIcon />, label: "Benevolence", to: "/benevolence" },
    { icon: <WorkOutlineRoundedIcon />, label: "Work", to: "/work" },
    { icon: <EventNoteRoundedIcon />, label: "Schedule", to: "/schedule" },
    { icon: <FactCheckRoundedIcon />, label: "Information", to: "/information" },
    { icon: <GroupRoundedIcon />, label: "Users", to: "/users" },
];

const accountLinks = [
    { icon: <PersonRoundedIcon />, label: "Profile", to: "/profile" },
    { icon: <LogoutRoundedIcon />, label: "Logout", to: "/logout" },
];

function Navigation({ user }) {
    const location = useLocation();
    const [expanded, setExpanded] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const isTouchDevice = useMediaQuery("(hover: none), (pointer: coarse)");
    const isMobileWidth = useMediaQuery("(max-width: 900px)");
    const useTemporaryDrawer = isTouchDevice && isMobileWidth;

    const isExpanded = useTemporaryDrawer ? true : expanded;
    const showSidebarHeaderMenuIcon = !useTemporaryDrawer;

    function handleNavigate() {
        if (useTemporaryDrawer) {
            setDrawerOpen(false);
        }
    }

    function renderLink(link) {
        const active = location.pathname === link.to;

        return (
            <Tooltip
                key={link.to}
                title={isExpanded ? "" : link.label}
                placement="right"
                disableHoverListener={isExpanded}
            >
                <ListItemButton
                    component={RouterLink}
                    to={link.to}
                    onClick={handleNavigate}
                    selected={active}
                    sx={{
                        minHeight: 48,
                        justifyContent: isExpanded ? "initial" : "center",
                        px: 2,
                        borderRadius: 0.5,
                        color: active ? "primary.main" : "text.primary",
                        backgroundColor: active ? "rgba(15, 118, 110, 0.12)" : "transparent",
                        "&:hover": {
                            backgroundColor: "rgba(15, 118, 110, 0.08)",
                        },
                        "&.Mui-selected": {
                            backgroundColor: "rgba(15, 118, 110, 0.14)",
                        },
                        "&.Mui-selected:hover": {
                            backgroundColor: "rgba(15, 118, 110, 0.18)",
                        },
                    }}
                >
                    <ListItemIcon
                        sx={{
                            minWidth: 0,
                            mr: isExpanded ? 1.75 : 0,
                            justifyContent: "center",
                            color: "inherit",
                        }}
                    >
                        {link.icon}
                    </ListItemIcon>
                    <ListItemText
                        primary={link.label}
                        primaryTypographyProps={{ fontWeight: 600 }}
                        sx={{
                            opacity: isExpanded ? 1 : 0,
                            maxWidth: isExpanded ? 160 : 0,
                            whiteSpace: "nowrap",
                            transition: "opacity 180ms ease, max-width 180ms ease",
                        }}
                    />
                </ListItemButton>
            </Tooltip>
        );
    }

    const sidebarContent = (
        <>
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: isExpanded && showSidebarHeaderMenuIcon ? 1.5 : 0,
                    justifyContent: isExpanded ? "flex-start" : "center",
                    px: 1.5,
                    pb: 2,
                }}
            >
                {showSidebarHeaderMenuIcon ? (
                    <IconButton
                        disableRipple
                        tabIndex={-1}
                        sx={{
                            width: 44,
                            height: 44,
                            backgroundColor: "rgba(15, 118, 110, 0.08)",
                            color: "primary.main",
                        }}
                    >
                        <MenuRoundedIcon />
                    </IconButton>
                ) : null}
                <Box
                    sx={{
                        opacity: isExpanded ? 1 : 0,
                        maxWidth: isExpanded ? 180 : 0,
                        overflow: "hidden",
                        transition: "opacity 180ms ease, max-width 180ms ease",
                    }}
                >
                    <Typography variant="overline" sx={{ color: "primary.main", letterSpacing: "0.18em" }}>
                        Deacons
                    </Typography>
                </Box>
            </Box>

            <List sx={{ display: "grid", gap: 0.75, px: 1, pt: 0 }}>
                {pageLinks.map(renderLink)}
            </List>

            <Box sx={{ mt: "auto", px: 1, pb: 1 }}>
                <Divider sx={{ mb: 1.5 }} />
                <Box
                    sx={{
                        px: isExpanded ? 1.5 : 0,
                        pb: 1,
                        display: "flex",
                        justifyContent: isExpanded ? "flex-start" : "center",
                    }}
                >
                    <Typography
                        variant="body2"
                        sx={{
                            color: "text.secondary",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            opacity: isExpanded ? 1 : 0,
                            maxWidth: isExpanded ? 180 : 0,
                            transition: "opacity 180ms ease, max-width 180ms ease",
                        }}
                    >
                        {user?.name || user?.email || "Signed out"}
                    </Typography>
                </Box>
                <List sx={{ display: "grid", gap: 0.75, p: 0 }}>
                    {accountLinks.map(renderLink)}
                </List>
            </Box>
        </>
    );

    if (useTemporaryDrawer) {
        return (
            <>
                {!drawerOpen ? (
                    <IconButton
                        aria-label="Open navigation menu"
                        className="mobile-nav-trigger"
                        onClick={() => setDrawerOpen(true)}
                        sx={{
                            position: "fixed",
                            top: 12,
                            left: 12,
                            zIndex: 1300,
                            width: 48,
                            height: 48,
                            backgroundColor: "rgba(255, 250, 242, 0.94)",
                            border: "1px solid rgba(15, 118, 110, 0.15)",
                            boxShadow: "0 10px 24px rgba(67, 55, 45, 0.16)",
                            color: "primary.main",
                        }}
                    >
                        <MenuRoundedIcon />
                    </IconButton>
                ) : null}

                <Drawer
                    open={drawerOpen}
                    onClose={() => setDrawerOpen(false)}
                    variant="temporary"
                    ModalProps={{ keepMounted: true }}
                    PaperProps={{
                        className: "sidebar",
                        sx: {
                            width: 260,
                            borderRight: "1px solid rgba(15, 118, 110, 0.12)",
                        },
                    }}
                >
                    {sidebarContent}
                </Drawer>
            </>
        );
    }

    return (
        <Box
            component="aside"
            className={expanded ? "sidebar sidebar-expanded" : "sidebar"}
            onMouseEnter={() => setExpanded(true)}
            onMouseLeave={() => setExpanded(false)}
            sx={{
                width: expanded ? 240 : 76,
            }}
        >
            {sidebarContent}
        </Box>
    );
}

export default Navigation;
