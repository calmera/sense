define(function (require) {
  'use strict';

  // App-wide dependencies.
  var angular = require('angular'); 
  var app = require('app');
  var _ = require('lodash');
  var config = require('config');

  require('services/marvel/index');

  // Module specific application dependencies
  var lazyStyle = require('./directives/lazyStyle');
  var shardGroups = require('./directives/shardGroups');
  var clusterView = require('./directives/clusterView');
  var segments = require('./directives/segments');
  var getValue = require('./lib/getValueFromArrayOrString');
  var labels = require('./lib/labels');
  var changeData = require('./lib/changeData');
  var getTimelineDataGenerator = require('./requests/getTimelineData');
  var getStateSourceGenerator = require('./requests/getStateSource');
  var updateColors = require('./lib/updateColors');
  var extractMarkers = require('./lib/extractMarkers');

  var module = angular.module('kibana.panels.marvel.shard_allocation', ['marvel.services']);
  app.useModule(module);

  // Custom Directives
  lazyStyle(module);
  shardGroups(module);
  clusterView(module);
  segments(module);
  
  module.controller('marvel.shard_allocation', function ($scope, $clusterState,
                    $http, $timeout, $injector, dashboard, filterSrv, alertSrv) {

    // Panel Metadata show in the Editor.
    $scope.panelMeta = {
      status: 'Experimental',
      description: 'A visualization of the cluster by nodes, shards and indices.'
    };

    var handleConnectionError = function () {
      alertSrv.set('Error',
       'The connection to Elasticsearch returned an error. Check your Elasticsearch instance.',
       'error', 30000);
    };

    $scope.player = {
      paused: false,
      fastForward: false,
      forward: false,
      backward: true,
      fastBackward: true
    };

    // Inject dependicies for the getTimelineData
    var getTimeline = $injector.invoke(getTimelineDataGenerator);
    var getStateSource = $injector.invoke(getStateSourceGenerator);

    // Create a partial with the config for the first argument
    getTimeline = _.partial(getTimeline, config);
    getStateSource = _.partial(getStateSource, config);


    // Defaults for the panel.
    var defaults = {
      show_hidden: false,
      view: 'nodes',
      labels: labels.nodes,
      rate: 500,
      showPlayer: true 
    };

    // Set the defaults for the $scope.panel (this is side effecting)
    _.defaults($scope.panel, defaults);
   
    // Change update the state of the ui based on the view
    $scope.$watch('panel.view', function () {
      changeData($scope);
    });

    // Filter the elements we are showning with the panel.filter
    $scope.filterResults = function () {
      changeData($scope);
    };

    $scope.$watch('panel.filter', _.debounce(function (newValue, oldValue) {
      if (newValue !== oldValue) {
        changeData($scope);
      }
    }, 500));

    // When the panel.show_hidden attribute is set we need to update the state
    // of the ui
    $scope.$watch('panel.show_hidden', function () {
      changeData($scope);
    });


    // This will update the $scope.panel.view variable which will in turn
    // update the ui using the $watch('panel.view') event listener.
    $scope.switchView = function (view) {
      $scope.panel.view = view;
      return false;
    };

    $scope.$watch('player.current', function (newValue) {
      // We can't do anything with an undefined value
      if (_.isUndefined(newValue)) {
        return;
      }

      if (($scope.player.current === $scope.player.total)) {
        $scope.player.forward = false;
        $scope.player.fastForward = false;
        $scope.player.paused = true;
      } else {
        $scope.player.forward = true;
        $scope.player.fastForward = true;
      }

      if (($scope.player.current === 0) && ($scope.player.total !== 0)) {
        $scope.player.backward = false;
        $scope.player.fastBackward = false;
      } else {
        $scope.player.backward = true;
        $scope.player.fastBackward = true;
      }

      $scope.barX = (($scope.player.current+1) / $scope.player.total)*100;
      if ($scope.barX > 100) {
        $scope.barX = 100;
      }

      // Due to the zero based counting and how we track where the head is,
      // when we get to the end we have to subtract one.
      var docIndex = $scope.player.current;
      if ($scope.player.current === $scope.player.total) {
        docIndex--;
      }
      
      var doc = $scope.timelineData[docIndex];
      if (doc) {
        getStateSource(doc).then(function (state) {
          $scope.currentState = state;
          changeData($scope);
        }, handleConnectionError);
      }

    });


    var timerId;

    var stop = function () {
      timerId = $timeout.cancel(timerId);
    };

    var changePosition = function () {
      if (!$scope.player.paused && ($scope.player.current !== $scope.player.total)) {
        ++$scope.player.current;
        timerId = $timeout(changePosition, $scope.panel.rate);
      }
    };

    $scope.jump = function ($event) {
      var position = $event.offsetX / $event.currentTarget.clientWidth; 
      $scope.player.current = Math.floor(position*$scope.player.total);
      $scope.player.paused = true;
    };

    $scope.head = function ($event) {
      var position = $event.offsetX / $event.currentTarget.clientWidth;
      var current = Math.floor(position*$scope.player.total);
      var timestamp = getValue($scope.timelineData[current].fields['@timestamp']);
      var message = getValue($scope.timelineData[current].fields.message);
      var status = getValue($scope.timelineData[current].fields.status);

      $scope.headX = $event.offsetX;
      $scope.headTime = timestamp;
      $scope.headMessage = message;
      $scope.headStatus = status;
    };

    $scope.$watch('player.paused', function () {
      stop();
      if($scope.player.paused === false) {
        changePosition();
      }
    });

    $scope.pause = function ($event) {
      $event.preventDefault();
      $scope.player.paused = true;
    };

    $scope.play = function ($event) {
      $event.preventDefault();
      if ($scope.player.current === $scope.player.total) {
        $scope.player.current = 0;  
        // We need to put the same amount of delay before we start the animation
        // otherwise it will feel like it's skipping the first frame.
        $timeout(function () {
          $scope.player.paused = false;
        }, $scope.panel.rate);
      } else {
        $scope.player.paused = false;
      }
    };

    $scope.forward = function ($event) {
      $event.preventDefault();
      if ($scope.player.current !== $scope.player.total) {
        ++$scope.player.current;
      }
      $scope.player.paused = true;
    };

    $scope.fastForward = function ($event) {
      $event.preventDefault();
      $scope.player.current = $scope.player.total;
      $scope.player.paused = true;
    };

    $scope.backward = function ($event) {
      $event.preventDefault();
      if ($scope.player.current !== 0) {
        --$scope.player.current;
      }
      $scope.player.paused = true;
    };

    $scope.rewind = function ($event) {
      $event.preventDefault();
      $scope.player.current = 0;
      $scope.player.paused = true;
    };

    var handleTimeline = function (data) {
      // If we get nothing back we need to use the current state.
      if (data.length === 0) {
        data = [{
          _index: $clusterState.state._index,
          _type: $clusterState.state._type,
          _id: $clusterState.state._id,
          fields: {
            '@timestamp': [ $clusterState.state['@timestamp'] ],
            'status': [ $clusterState.state.status ],
            'message': [ $clusterState.state.message ]
          }
        }] ;
      }

      $scope.timelineData = data;
      $scope.timelineMarkers = extractMarkers(data);
      $scope.player.total = (data.length > 0 && data.length) || 1;
      $scope.player.current = $scope.player.total; 
      $scope.paused = true;
      updateColors($scope);
      $scope.total = $scope.player.total;
    };


    // If the time range updates then we need to update the timeline
    $scope.$on('refresh', function () {

      if (!$scope.panel.showPlayer) {
        return;
      }

      var timeRange = filterSrv.timeRange(false);
      var timeChanged = (timeRange.from !== $scope.timeRange.from ||
                         timeRange.to   !== $scope.timeRange.to);

      if (timeChanged) {
        $scope.timeRange = timeRange;
        getTimeline().then(handleTimeline, handleConnectionError);
      }
    });

    var handleUpdatesFromClusterState = function ($scope) {
      return function () {
        var current = ($scope.player.current === $scope.player.total);
        if ($scope.player.paused && current) {
          getTimeline().then(handleTimeline, handleConnectionError);
        }
      };
    };

    $scope.init = function () {
      $scope.timeRange = filterSrv.timeRange(false);
      $scope.style = dashboard.current.style;
      $scope.timelineData = [];
      $scope.showHead = false;
      getTimeline().then(handleTimeline, handleConnectionError).then(function () {
        // Don't start listening to updates till we finish initlaizing
        $clusterState.$on('update', handleUpdatesFromClusterState($scope));
      });
    };
  });
});