package site.ajmfamily.admin.ui.nav

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import site.ajmfamily.admin.di.AppContainer
import site.ajmfamily.admin.di.ViewModelFactory
import site.ajmfamily.admin.ui.admin.AdminGateScreen
import site.ajmfamily.admin.ui.admin.AdminViewModel
import site.ajmfamily.admin.ui.admin.RegistrationsScreen
import site.ajmfamily.admin.ui.admin.history.HistoryScreen
import site.ajmfamily.admin.ui.admin.zoom.ZoomSendScreen
import site.ajmfamily.admin.ui.home.HomeScreen
import site.ajmfamily.admin.ui.media.MediaGateScreen
import site.ajmfamily.admin.ui.media.MediaOfficeScreen
import site.ajmfamily.admin.ui.media.MediaViewModel
import site.ajmfamily.admin.ui.settings.SettingsScreen

@Composable
fun AjmNavHost(container: AppContainer) {
    val navController = rememberNavController()
    val factory = remember(container) { ViewModelFactory(container) }

    NavHost(navController = navController, startDestination = Routes.HOME) {
        composable(Routes.HOME) {
            HomeScreen(
                onOpenAdmin = { navController.navigate(Routes.ADMIN_GATE) },
                onOpenMedia = { navController.navigate(Routes.MEDIA_GATE) },
                onOpenSettings = { navController.navigate(Routes.SETTINGS) }
            )
        }

        composable(Routes.SETTINGS) {
            SettingsScreen(session = container.session, onBack = { navController.popBackStack() })
        }

        composable(Routes.ADMIN_GATE) {
            AdminGateScreen(
                api = container.api,
                session = container.session,
                onSignedIn = {
                    navController.navigate(Routes.ADMIN_REGISTRATIONS) {
                        popUpTo(Routes.ADMIN_GATE) { inclusive = true }
                    }
                },
                onGoToSettings = { navController.navigate(Routes.SETTINGS) }
            )
        }

        composable(Routes.ADMIN_REGISTRATIONS) {
            val adminViewModel: AdminViewModel = viewModel(factory = factory)
            RegistrationsScreen(
                viewModel = adminViewModel,
                onOpenHistory = { navController.navigate(Routes.ADMIN_HISTORY) },
                onOpenZoomSend = { navController.navigate(Routes.ADMIN_ZOOM_SEND) },
                onLogOut = {
                    container.session.clearAdminKey()
                    navController.popBackStack(Routes.HOME, inclusive = false)
                }
            )
        }

        composable(Routes.ADMIN_HISTORY) {
            val adminViewModel: AdminViewModel = viewModel(factory = factory)
            HistoryScreen(viewModel = adminViewModel, onBack = { navController.popBackStack() })
        }

        composable(Routes.ADMIN_ZOOM_SEND) {
            val adminViewModel: AdminViewModel = viewModel(factory = factory)
            ZoomSendScreen(
                viewModel = adminViewModel,
                onDone = { navController.popBackStack() }
            )
        }

        composable(Routes.MEDIA_GATE) {
            MediaGateScreen(
                api = container.api,
                session = container.session,
                onSignedIn = {
                    navController.navigate(Routes.MEDIA_OFFICE) {
                        popUpTo(Routes.MEDIA_GATE) { inclusive = true }
                    }
                },
                onGoToSettings = { navController.navigate(Routes.SETTINGS) }
            )
        }

        composable(Routes.MEDIA_OFFICE) {
            val mediaViewModel: MediaViewModel = viewModel(factory = factory)
            MediaOfficeScreen(
                viewModel = mediaViewModel,
                onLogOut = {
                    container.session.clearMediaKey()
                    navController.popBackStack(Routes.HOME, inclusive = false)
                }
            )
        }
    }
}
