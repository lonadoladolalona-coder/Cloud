package site.ajmfamily.admin.di

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import site.ajmfamily.admin.ui.admin.AdminViewModel
import site.ajmfamily.admin.ui.media.MediaViewModel

class ViewModelFactory(private val container: AppContainer) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = when {
        modelClass.isAssignableFrom(AdminViewModel::class.java) ->
            AdminViewModel(container.api, container.session) as T
        modelClass.isAssignableFrom(MediaViewModel::class.java) ->
            MediaViewModel(container.api, container.session) as T
        else -> throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
